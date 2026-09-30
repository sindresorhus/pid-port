import process from 'node:process';
import http from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import getPort from 'get-port';
import {
	portToPid,
	pidToPorts,
	allPortsWithPid,
	portBindings,
} from './index.js';

const execFileAsync = promisify(execFile);

// `node:test` has no default per-test timeout, and these tests spawn real `netstat`/`lsof`
// child processes, so every test needs an explicit limit.
const testTimeout = 30_000;

const loadPidParser = async t => {
	const temporaryDirectory = await fs.mkdtemp(path.join(process.cwd(), '.ai-temporary-'));
	t.after(async () => {
		await fs.rm(temporaryDirectory, {recursive: true, force: true});
	});

	const source = await fs.readFile(new URL('index.js', import.meta.url), 'utf8');
	const modulePath = path.join(temporaryDirectory, 'index-internals.mjs');
	// eslint-disable-next-line unicorn/no-incorrect-template-string-interpolation -- `{findPidInLine}` is the literal re-export that makes the internal reachable, not a missed interpolation.
	await fs.writeFile(modulePath, `${source}\nexport {findPidInLine};\n`);
	return import(pathToFileURL(modulePath).href);
};

const createServer = () => http.createServer((request, response) => {
	response.end();
});

const closeServer = server => new Promise(resolve => {
	server.close(() => {
		resolve();
	});
});

// Cleanup goes in `t.after` rather than `finally`: a test that times out is aborted without
// unwinding, and a server left listening keeps the event loop alive, so the run hangs.
const startServer = async (t, port, host) => {
	const server = createServer();
	t.after(() => closeServer(server));
	// Reject on a listen error, otherwise `EADDRINUSE` never settles this promise and the
	// only thing the runner reports is the per-test timeout.
	await new Promise((resolve, reject) => {
		server.listen(port, host, resolve).once('error', reject);
	});
	return server;
};

// Puts fake `netstat`/`ss`/`lsof` executables at the front of `PATH` so the fallback parsing
// runs against fixed output instead of the real tools.
const shadowCommands = async (t, commands) => {
	const originalPath = process.env.PATH;
	const primaryCommand = process.platform === 'linux' ? 'ss' : 'netstat';

	await fs.mkdir('.ai-temporary', {recursive: true});
	const temporaryDirectory = await fs.mkdtemp(path.join('.ai-temporary', 'pid-port-'));
	t.after(async () => {
		process.env.PATH = originalPath;
		await fs.rm(temporaryDirectory, {recursive: true, force: true});
	});

	const scripts = {[primaryCommand]: '#!/bin/sh\nexit 1\n', ...commands};
	await Promise.all(Object.entries(scripts).map(async ([name, body]) => {
		const script = path.join(temporaryDirectory, name);
		await fs.writeFile(script, body);
		await fs.chmod(script, 0o755);
	}));

	process.env.PATH = `${temporaryDirectory}:${originalPath}`;
};

const lsofOutput = `#!/bin/sh
cat <<'EOF'
COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
node 12345 user 20u IPv4 0x123 0t0 TCP 127.0.0.1:49152->127.0.0.1:5432 (ESTABLISHED)
EOF
`;

test('portToPid()', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '127.0.0.1');
	assert.equal(await portToPid(port), process.pid);
});

test('fail', {timeout: testTimeout}, async () => {
	await assert.rejects(portToPid(0), {message: 'Expected a TCP/UDP port between 1 and 65535, got 0'});
	await assert.rejects(portToPid([0]), {message: 'Expected port to be an integer between 1 and 65535, got 0'});
});

test('accepts an integer', {timeout: testTimeout}, async () => {
	await assert.rejects(portToPid('foo'), {message: 'Expected a TCP/UDP port between 1 and 65535, got foo'});
	await assert.rejects(portToPid(0.5), {message: 'Expected a TCP/UDP port between 1 and 65535, got 0.5'});
});

test('multiple', {timeout: testTimeout}, async t => {
	const [port1, port2] = await Promise.all([getPort(), getPort()]);
	await Promise.all([
		startServer(t, port1, '127.0.0.1'),
		startServer(t, port2, '127.0.0.1'),
	]);

	const ports = await portToPid([port1, port2]);

	assert.ok(ports instanceof Map);

	for (const port of ports.values()) {
		assert.equal(typeof port, 'number');
	}
});

test('pidToPorts()', {timeout: testTimeout}, async t => {
	const [firstPort, secondPort] = await Promise.all([getPort(), getPort()]);
	await Promise.all([
		startServer(t, firstPort, '127.0.0.1'),
		startServer(t, secondPort, '127.0.0.1'),
	]);

	const portsToCheck = [firstPort, secondPort];

	const pidPorts = await pidToPorts(process.pid);

	for (const port of portsToCheck) {
		assert.ok(pidPorts.has(port));
	}

	const ports = await pidToPorts([process.pid]);
	const pidsPorts = ports.get(process.pid);

	for (const port of portsToCheck) {
		assert.ok(pidsPorts.has(port));
	}
});

test('allPortsWithPid()', {timeout: testTimeout}, async () => {
	const all = await allPortsWithPid();
	assert.ok(all instanceof Map);

	// Test that we can resolve localhost ports with predictable behavior
	const localhostPorts = all.keys().take(3).toArray();

	const results = await Promise.allSettled(localhostPorts.map(async port => portToPid({port, host: '*'})));

	for (const result of results) {
		// All should succeed when explicitly checking all interfaces
		assert.equal(result.status, 'fulfilled');
		assert.equal(typeof result.value, 'number');
	}
});

test('host option with single host', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '127.0.0.1');

	// Test options object API
	const pid1 = await portToPid({port, host: '127.0.0.1'});
	assert.equal(pid1, process.pid);

	// Test without host (should also work)
	const pid2 = await portToPid({port});
	assert.equal(pid2, process.pid);
});

test('host option error handling', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '127.0.0.1');

	// Test with non-existent host
	await assert.rejects(
		portToPid({port, host: '192.168.999.999'}),
		{message: `Could not find a process that uses port \`${port}\` on host \`192.168.999.999\``},
	);

	// Test invalid host type
	await assert.rejects(
		portToPid({port, host: 123}),
		{message: 'Expected host to be a string, got number'},
	);
});

test('predictable port selection', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '127.0.0.1');

	// PortToPid should return predictable result (sorted by host)
	const pid = await portToPid(port);
	assert.equal(pid, process.pid);

	// Explicit host should also work
	const pidWithHost = await portToPid({port, host: '127.0.0.1'});
	assert.equal(pidWithHost, process.pid);

	// PortBindings should show localhost bindings
	const bindings = await portBindings(port);
	assert.ok(bindings.length > 0);
	assert.ok(bindings.some(binding => binding.pid === process.pid && binding.host === '127.0.0.1'));
});

test('allPortsWithPid with host filter', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '127.0.0.1');

	// Test without host filter
	const all = await allPortsWithPid();
	assert.ok(all.has(port));

	// Test with host filter
	const filtered = await allPortsWithPid({host: '127.0.0.1'});
	assert.ok(filtered.has(port));
	assert.equal(filtered.get(port), process.pid);

	// Test with non-existent host
	const empty = await allPortsWithPid({host: '192.168.999.999'});
	assert.ok(!empty.has(port));
});

test('portBindings', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '127.0.0.1');

	// Test getting localhost bindings (default)
	const bindings = await portBindings(port);
	assert.ok(Array.isArray(bindings));
	assert.ok(bindings.length > 0);

	// Should have our binding
	const ourBinding = bindings.find(binding => binding.pid === process.pid);
	assert.ok(ourBinding);
	assert.equal(ourBinding.host, '127.0.0.1');

	// Test with all interfaces
	const allBindings = await portBindings(port, {host: '*'});
	assert.ok(allBindings.length >= bindings.length);

	// Test with invalid port (out of range)
	await assert.rejects(
		portBindings(99_999),
		{message: 'Expected a TCP/UDP port between 1 and 65535, got 99999'},
	);
});

test('sorting is predictable', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '127.0.0.1');

	// Multiple calls should return same result (predictable sorting)
	const result1 = await portToPid(port);
	const result2 = await portToPid(port);
	assert.equal(result1, result2);

	// Bindings should be sorted by host
	const bindings = await portBindings(port);
	for (let index = 1; index < bindings.length; index++) {
		assert.ok(bindings[index - 1].host.localeCompare(bindings[index].host) <= 0);
	}
});

test('portToPid unified API', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '127.0.0.1');

	// Test both API styles work identically
	const pidDirect = await portToPid(port);
	const pidOptions = await portToPid({port});
	assert.equal(pidDirect, pidOptions);
	assert.equal(pidDirect, process.pid);

	// Test with host specified
	const pidWithHost = await portToPid({port, host: '127.0.0.1'});
	assert.equal(pidWithHost, process.pid);
});

test('lsof fallback keeps connected local sockets', {timeout: testTimeout}, async t => {
	if (process.platform === 'win32') {
		t.skip('lsof is not available on Windows');
		return;
	}

	await shadowCommands(t, {lsof: lsofOutput});

	assert.equal(await portToPid(49_152), 12_345);
	assert.deepEqual(await allPortsWithPid(), new Map([[49_152, 12_345]]));
	assert.deepEqual(await pidToPorts(12_345), new Set([49_152]));
});

test('lsof fallback does not treat remote ports as local bindings', {timeout: testTimeout}, async t => {
	if (process.platform === 'win32') {
		t.skip('lsof is not available on Windows');
		return;
	}

	await shadowCommands(t, {lsof: lsofOutput});

	await assert.rejects(portToPid(5432), {message: 'Could not find a process that uses port `5432` on localhost'});
	await assert.rejects(portBindings(5432), {message: 'Could not find any processes using port `5432` on localhost'});
});

test('empty lsof fallback behaves like an empty connection list', {timeout: testTimeout}, async t => {
	if (process.platform === 'win32') {
		t.skip('lsof is not available on Windows');
		return;
	}

	await shadowCommands(t, {lsof: '#!/bin/sh\nexit 1\n'});

	await assert.rejects(portToPid(12_345), {message: 'Could not find a process that uses port `12345` on localhost'});
	assert.deepEqual(await allPortsWithPid(), new Map());
	assert.deepEqual(await pidToPorts(12_345), new Set());
	await assert.rejects(portBindings(12_345), {message: 'Could not find any processes using port `12345` on localhost'});
});

test('macOS: empty TCP netstat output falls back to lsof even when UDP has rows', {timeout: testTimeout}, async t => {
	if (process.platform !== 'darwin') {
		t.skip('macOS only');
		return;
	}

	await shadowCommands(t, {
		netstat: `#!/bin/sh
if [ "$3" = "tcp" ]; then
	exit 0
fi

cat <<'EOF'
Active Internet connections (including servers)
Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)          rxbytes      txbytes  rhiwat  shiwat          process:pid    state  options           gencnt    flags   flags1 usecnt rtncnt fltrs
udp4       0      0  127.0.0.1.5353         *.*                                          0            0  786896    9216      mDNSResponder:1  00000 00000000 0000000000000001 00000000 00000000      1      0 000001
EOF
`,
		lsof: lsofOutput,
	});

	assert.equal(await portToPid(49_152), 12_345);
});

test('lsof fallback resolves LISTEN sockets without arrow notation', {timeout: testTimeout}, async t => {
	if (process.platform === 'win32') {
		t.skip('lsof is not available on Windows');
		return;
	}

	await shadowCommands(t, {
		lsof: `#!/bin/sh
cat <<'EOF'
COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
node 99999 user 20u IPv4 0x123 0t0 TCP 127.0.0.1:8080 (LISTEN)
EOF
`,
	});

	assert.equal(await portToPid(8080), 99_999);
	assert.deepEqual(await allPortsWithPid(), new Map([[8080, 99_999]]));
});

test('Linux: process names with spaces do not break PID extraction', {timeout: testTimeout}, async t => {
	if (process.platform !== 'linux') {
		t.skip('ss output is Linux-only');
		return;
	}

	const originalTitle = process.title;
	const originalPath = process.env.PATH;
	const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pid-port-'));

	t.after(async () => {
		process.title = originalTitle;
		process.env.PATH = originalPath;
		await fs.rm(temporaryDirectory, {recursive: true, force: true});
	});

	process.title = 'next-server (v16.1.1)';

	const port = await getPort();
	await startServer(t, port, '127.0.0.1');

	// Ensure we actually hit the problematic ss tokenization case on this system
	const {stdout} = await execFileAsync('ss', ['-tunlp']);
	const matchingLine = stdout
		.split('\n')
		.find(line => line.includes(`:${port}`) && line.includes(`pid=${process.pid}`));

	if (!matchingLine) {
		t.skip('ss output does not include PID info');
		return;
	}

	const columns = matchingLine.match(/\S+/gv) ?? [];
	const pidColumn = 6;
	const pidIndex = columns.findIndex((column, index) => index >= pidColumn && column.includes(`pid=${process.pid}`));

	if (pidIndex <= pidColumn) {
		t.skip('ss output does not shift the PID column');
		return;
	}

	// Shadow lsof so the fix must work without the lsof fallback
	const shadowedLsof = path.join(temporaryDirectory, 'lsof');
	await fs.writeFile(shadowedLsof, '#!/bin/sh\nexit 1\n');
	await fs.chmod(shadowedLsof, 0o755);
	process.env.PATH = `${temporaryDirectory}:${originalPath}`;

	assert.equal(await portToPid(port), process.pid);
});

test('Windows: PID parsing works for both TCP and UDP netstat rows', {timeout: testTimeout}, async t => {
	const {findPidInLine} = await loadPidParser(t);
	const tcpColumns = 'TCP 127.0.0.1:58_566 127.0.0.1:5173 ESTABLISHED 67_932'.replaceAll('_', '').match(/\S+/gv);
	const udpColumns = 'UDP 127.0.0.1:1900 *:* 19_048'.replaceAll('_', '').match(/\S+/gv);
	const unavailablePidColumns = 'UDP 127.0.0.1:1900 *:* 0'.match(/\S+/gv);

	assert.equal(findPidInLine(tcpColumns, 3, 'windows'), 67_932);
	assert.equal(findPidInLine(udpColumns, 3, 'windows'), 19_048);
	assert.equal(findPidInLine(unavailablePidColumns, 3, 'windows'), undefined);
});

test('macOS: PID parsing supports current process names and legacy bare PIDs', {timeout: testTimeout}, async t => {
	const {findPidInLine} = await loadPidParser(t);
	const tcpRow = processColumn => `tcp4 0 0 127.0.0.1.8000 *.* LISTEN 0 0 131072 131072 ${processColumn} 00100 00000006`.match(/\S+/gv);
	const udpRow = processColumn => `udp4 0 0 127.0.0.1.8000 *.* 0 0 131072 131072 ${processColumn} 00100 00000006`.match(/\S+/gv);
	const legacyTcpRowWithByteCounts = processColumn => `tcp4 0 0 127.0.0.1.8000 *.* LISTEN 0 0 131072 131072 ${processColumn} 0 00100 00000006`.match(/\S+/gv);
	const legacyUdpRowWithByteCounts = processColumn => `udp4 0 0 127.0.0.1.8000 *.* 0 0 131072 131072 ${processColumn} 0 00100 00000006`.match(/\S+/gv);
	const legacyTcpRow = processColumn => `tcp4 0 0 127.0.0.1.8000 *.* LISTEN 131072 131072 ${processColumn} 0 00100 00000006`.match(/\S+/gv);
	const legacyUdpRow = processColumn => `udp4 0 0 127.0.0.1.8000 *.* 131072 131072 ${processColumn} 0 00100 00000006`.match(/\S+/gv);

	assert.equal(findPidInLine(tcpRow('python3.12:76594'), 10, 'macos'), 76_594);
	assert.equal(findPidInLine(tcpRow('2.1.250:77076'), 10, 'macos'), 77_076);
	assert.equal(findPidInLine(tcpRow('3proxy:76594'), 10, 'macos'), 76_594);
	assert.equal(findPidInLine(tcpRow('worker_2:54321'), 10, 'macos'), 54_321);
	assert.equal(findPidInLine(tcpRow('com.docker.backe:64422'), 10, 'macos'), 64_422);
	assert.equal(findPidInLine(tcpRow('app:worker:12345'), 10, 'macos'), 12_345);
	assert.equal(findPidInLine(tcpRow(':76594'), 10, 'macos'), 76_594);
	assert.equal(findPidInLine(tcpRow('76594'), 10, 'macos'), undefined);
	assert.equal(findPidInLine(legacyTcpRowWithByteCounts('76594'), 10, 'macosLegacy'), 76_594);
	assert.equal(findPidInLine(legacyUdpRowWithByteCounts('76594'), 10, 'macosLegacy'), 76_594);
	assert.equal(findPidInLine(legacyTcpRow('76594'), 8, 'macosLegacy'), 76_594);
	assert.equal(findPidInLine(udpRow('python3.12:76594'), 10, 'macos'), 76_594);
	assert.equal(findPidInLine(legacyUdpRow('76594'), 8, 'macosLegacy'), 76_594);
});

test('macOS: PID parsing supports process names with spaces', {timeout: testTimeout}, async t => {
	const {findPidInLine} = await loadPidParser(t);
	const tcpRow = processColumn => `tcp6 0 0 ::1.8000 *.* LISTEN 0 0 131072 131072 ${processColumn} 00100 00000006`.match(/\S+/gv);
	const udpRow = processColumn => `udp46 0 0 *.8000 *.* 0 0 131072 131072 ${processColumn} 00100 00000006`.match(/\S+/gv);

	assert.equal(findPidInLine(tcpRow('Codex (Service):71296'), 10, 'macos'), 71_296);
	assert.equal(findPidInLine(tcpRow('worker:80 child:71296'), 10, 'macos'), 71_296);
	assert.equal(findPidInLine(tcpRow('123 worker:71296'), 10, 'macos'), 71_296);
	assert.equal(findPidInLine(udpRow('Codex (Service):71296'), 10, 'macos'), 71_296);
});

test('macOS: PID zero is treated as unavailable', {timeout: testTimeout}, async t => {
	const {findPidInLine} = await loadPidParser(t);
	const tcpRow = 'tcp4 0 0 127.0.0.1.8000 *.* LISTEN 0 0 131072 131072 :0 00100 00000006 00000000003ee95a'.match(/\S+/gv);
	const udpRow = 'udp4 0 0 127.0.0.1.8000 *.* 0 0 131072 131072 :0 00100 00000006 00000000003ee95a'.match(/\S+/gv);
	const legacyTcpRowWithByteCounts = 'tcp4 0 0 127.0.0.1.8000 *.* LISTEN 0 0 131072 131072 0 0 00100 00000006 00000000003ee95a'.match(/\S+/gv);
	const legacyUdpRowWithByteCounts = 'udp4 0 0 127.0.0.1.8000 *.* 0 0 131072 131072 0 0 00100 00000006 00000000003ee95a'.match(/\S+/gv);
	const legacyTcpRow = 'tcp4 0 0 127.0.0.1.8000 *.* LISTEN 131072 131072 0 0 00100 00000006'.match(/\S+/gv);
	const legacyUdpRow = 'udp4 0 0 127.0.0.1.8000 *.* 131072 131072 0 0 00100 00000006'.match(/\S+/gv);

	assert.equal(findPidInLine(tcpRow, 10, 'macos'), undefined);
	assert.equal(findPidInLine(udpRow, 10, 'macos'), undefined);
	assert.equal(findPidInLine(legacyTcpRowWithByteCounts, 10, 'macosLegacy'), undefined);
	assert.equal(findPidInLine(legacyUdpRowWithByteCounts, 10, 'macosLegacy'), undefined);
	assert.equal(findPidInLine(legacyTcpRow, 8, 'macosLegacy'), undefined);
	assert.equal(findPidInLine(legacyUdpRow, 8, 'macosLegacy'), undefined);
});

test('Linux: authoritative pid field wins across split process names', {timeout: testTimeout}, async t => {
	const {findPidInLine} = await loadPidParser(t);
	const row = processDescription => `tcp LISTEN 0 511 127.0.0.1:8000 *:* ${processDescription}`.match(/\S+/gv);

	assert.equal(findPidInLine(row('users:(("node",pid=1337,fd=3))'), 6, 'linux'), 1337);
	assert.equal(findPidInLine(row('users:(("next-server (v16.1.1)",pid=1337,fd=3))'), 6, 'linux'), 1337);
	assert.equal(findPidInLine(row('users:(("python3.12:80 worker",pid=1337,fd=3))'), 6, 'linux'), 1337);
	assert.equal(findPidInLine(row('users:(("worker:80 child",pid=1337,fd=3))'), 6, 'linux'), 1337);
	assert.equal(findPidInLine(row('users:(("2.1.250:80 worker",pid=1337,fd=3))'), 6, 'linux'), 1337);
	assert.equal(findPidInLine(row('users:(("pid=80 worker",pid=1337,fd=3))'), 6, 'linux'), 1337);
	assert.equal(findPidInLine(row('users:(("worker pid=80",pid=1337,fd=3))'), 6, 'linux'), 1337);
});

test('Linux: PID parsing supports the legacy process description', {timeout: testTimeout}, async t => {
	const {findPidInLine} = await loadPidParser(t);
	const row = 'tcp LISTEN 0 511 127.0.0.1:8000 *:* users:(("node",1337,fd=3))'.match(/\S+/gv);

	assert.equal(findPidInLine(row, 6, 'linux'), 1337);
});

test('Linux: PID parsing ignores process-title numbers and unavailable PIDs', {timeout: testTimeout}, async t => {
	const {findPidInLine} = await loadPidParser(t);
	const row = 'tcp LISTEN 0 511 127.0.0.1:8000 *:* users:(("worker:80 child"))'.match(/\S+/gv);
	const unavailablePidRow = 'tcp LISTEN 0 511 127.0.0.1:8000 *:* users:(("kernel",pid=0,fd=3))'.match(/\S+/gv);

	assert.equal(findPidInLine(row, 6, 'linux'), undefined);
	assert.equal(findPidInLine(unavailablePidRow, 6, 'linux'), undefined);
});

test('lsof: PID parsing uses the dedicated PID column', {timeout: testTimeout}, async t => {
	const {findPidInLine} = await loadPidParser(t);
	const row = 'node 12345 user 20u IPv4 0x123 0t0 TCP 127.0.0.1:8080 (LISTEN)'.match(/\S+/gv);
	const rowWithoutPid = 'node - user 20u IPv4 12345 0t0 TCP 127.0.0.1:8080 (LISTEN)'.match(/\S+/gv);
	const rowWithUnavailablePid = 'node 0 user 20u IPv4 0x123 0t0 TCP 127.0.0.1:8080 (LISTEN)'.match(/\S+/gv);

	assert.equal(findPidInLine(row, 1, 'lsof'), 12_345);
	assert.equal(findPidInLine(rowWithoutPid, 1, 'lsof'), undefined);
	assert.equal(findPidInLine(rowWithUnavailablePid, 1, 'lsof'), undefined);
});

test('error messages', {timeout: testTimeout}, async () => {
	// Test validation errors first
	await assert.rejects(
		portToPid(99_999),
		{message: 'Expected a TCP/UDP port between 1 and 65535, got 99999'},
	);

	await assert.rejects(
		portToPid('not-a-number'),
		{message: 'Expected a TCP/UDP port between 1 and 65535, got not-a-number'},
	);

	await assert.rejects(
		portToPid({port: 'not-a-number'}),
		{message: 'Expected port to be an integer between 1 and 65535, got not-a-number'},
	);

	// Test runtime errors with valid ports that aren't in use
	const unusedPort = await getPort();
	await assert.rejects(
		portToPid(unusedPort),
		{message: `Could not find a process that uses port \`${unusedPort}\` on localhost`},
	);

	await assert.rejects(
		portToPid({port: unusedPort, host: '127.0.0.1'}),
		{message: `Could not find a process that uses port \`${unusedPort}\` on host \`127.0.0.1\``},
	);

	await assert.rejects(
		portToPid({port: unusedPort, host: '*'}),
		{message: `Could not find a process that uses port \`${unusedPort}\``},
	);
});

test('IPv6 localhost support', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '::1');

	// Should find the process on IPv6 localhost
	const pid = await portToPid(port);
	assert.equal(pid, process.pid);

	// Should also work with explicit IPv6 localhost
	const pidExplicit = await portToPid({port, host: '::1'});
	assert.equal(pidExplicit, process.pid);
});

test('host regex escaping', {timeout: testTimeout}, async t => {
	const server = await startServer(t, 0, '127.0.0.1');
	const address = server.address();

	assert.notEqual(address, null);
	assert.equal(typeof address, 'object');

	const {port} = address;

	// Test that dots in host are treated literally, not as regex wildcards
	// If regex escaping is broken, '127x0x0x1' might incorrectly match '127.0.0.1'
	await assert.rejects(
		portToPid({port, host: '127x0x0x1'}),
		{message: `Could not find a process that uses port \`${port}\` on host \`127x0x0x1\``},
	);

	// But the correct host should work
	const pid = await portToPid({port, host: '127.0.0.1'});
	assert.equal(pid, process.pid);
});

test('edge case host values', {timeout: testTimeout}, async () => {
	const port = await getPort();

	// Test empty string host
	await assert.rejects(
		portToPid({port, host: ''}),
		{message: `Could not find a process that uses port \`${port}\` on host \`\``},
	);

	// Test invalid host type
	await assert.rejects(
		portToPid({port, host: 123}),
		{message: 'Expected host to be a string, got number'},
	);
});

test('allPortsWithPid localhost-only default', {timeout: testTimeout}, async t => {
	const port1 = await getPort();
	const port2 = await getPort();

	// Create one localhost server and get one all-interfaces server
	await startServer(t, port1, '127.0.0.1');
	await startServer(t, port2);

	// Default should only return localhost ports
	const localhostPorts = await allPortsWithPid();
	assert.ok(localhostPorts.has(port1)); // Should have localhost port
	assert.ok(!localhostPorts.has(port2)); // Should NOT have all-interfaces port

	// Explicit all interfaces should return both
	const allPorts = await allPortsWithPid({host: '*'});
	assert.ok(allPorts.has(port1)); // Should have localhost port
	assert.ok(allPorts.has(port2)); // Should have all-interfaces port
});

test('validation error handling', {timeout: testTimeout}, async () => {
	// Test pidToPorts with invalid PID
	await assert.rejects(
		pidToPorts('not-a-number'),
		{message: 'Expected an integer, got string'},
	);

	await assert.rejects(
		pidToPorts(1.5),
		{message: 'Expected an integer, got number'},
	);

	// Test portBindings with invalid port
	await assert.rejects(
		portBindings('not-a-number'),
		{message: 'Expected a TCP/UDP port between 1 and 65535, got not-a-number'},
	);

	await assert.rejects(
		portBindings(0),
		{message: 'Expected a TCP/UDP port between 1 and 65535, got 0'},
	);

	await assert.rejects(
		portBindings(70_000),
		{message: 'Expected a TCP/UDP port between 1 and 65535, got 70000'},
	);

	// Test allPortsWithPid with invalid host
	await assert.rejects(
		allPortsWithPid({host: 123}),
		{message: 'Expected host to be a string, got number'},
	);

	// Test portToPid with invalid port in options
	await assert.rejects(
		portToPid({port: 0}),
		{message: 'Expected port to be an integer between 1 and 65535, got 0'},
	);

	await assert.rejects(
		portToPid({port: 70_000}),
		{message: 'Expected port to be an integer between 1 and 65535, got 70000'},
	);

	await assert.rejects(
		portToPid({port: 8080, host: 123}),
		{message: 'Expected host to be a string, got number'},
	);
});

test('pidToPorts returns all interfaces', {timeout: testTimeout}, async t => {
	const port1 = await getPort();
	const port2 = await getPort();

	// Create servers on different interfaces
	await startServer(t, port1, '127.0.0.1');
	await startServer(t, port2);

	// PidToPorts should return ALL ports for the process, regardless of interface
	const ports = await pidToPorts(process.pid);
	assert.ok(ports.has(port1)); // Should have localhost port
	assert.ok(ports.has(port2)); // Should have all-interfaces port
});

test('IPv6 bracket stripping behavior', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '::1');

	// Windows might return bracketed IPv6 addresses - our parsing should handle it
	// Test that {host: '::1'} works correctly for finding IPv6 localhost
	const pid = await portToPid({port, host: '::1'});
	assert.equal(pid, process.pid);

	// Test that portBindings returns clean IPv6 without brackets
	const bindings = await portBindings(port);
	const ipv6Binding = bindings.find(binding => binding.host.includes(':'));
	if (!ipv6Binding) {
		return;
	}

	// Should not have brackets if we're properly stripping them
	assert.ok(!ipv6Binding.host.startsWith('['));
	assert.ok(!ipv6Binding.host.endsWith(']'));
});

test('localhost keyword explicit support', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '127.0.0.1');

	// Test that explicit 'localhost' string works as host filter
	const pid = await portToPid({port, host: 'localhost'});
	assert.equal(pid, process.pid);

	const bindings = await portBindings(port, {host: 'localhost'});
	assert.ok(bindings.length > 0);
	assert.ok(bindings.some(binding => binding.pid === process.pid));
});

test('IPv6 host filtering without brackets', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '::1');

	// Should work with IPv6 localhost
	const pid = await portToPid({port, host: '::1'});
	assert.equal(pid, process.pid);

	// Should also work with default localhost filter
	const pidDefault = await portToPid(port);
	assert.equal(pidDefault, process.pid);

	// Test that portBindings returns unbracketed IPv6
	const bindings = await portBindings(port);
	assert.ok(bindings.some(binding => binding.host === '::1'));
});

test('multiple ports with missing port handling', {timeout: testTimeout}, async t => {
	const [usedPort, unusedPort] = await Promise.all([getPort(), getPort()]);
	await startServer(t, usedPort, '127.0.0.1');

	// Should throw on first missing port
	await assert.rejects(
		portToPid([usedPort, unusedPort]),
		{message: /Could not find a process that uses port/v},
	);
});

test('host normalization and wildcard support', {timeout: testTimeout}, async t => {
	const port = await getPort();
	const server = await startServer(t, port, '127.0.0.1');

	// 'localhost' should normalize to '127.0.0.1'
	const pidLocalhost = await portToPid({port, host: 'localhost'});
	assert.equal(pidLocalhost, process.pid);

	// Should work with explicit '127.0.0.1'
	const pidExplicit = await portToPid({port, host: '127.0.0.1'});
	assert.equal(pidExplicit, process.pid);

	// Test wildcard on all interfaces server
	await closeServer(server);
	await startServer(t, port);

	// '*' and '0.0.0.0' should work as wildcards
	const wildcard1 = await portToPid({port, host: '*'});
	assert.equal(wildcard1, process.pid);

	const wildcard2 = await portToPid({port, host: '0.0.0.0'});
	assert.equal(wildcard2, process.pid);
});

test('portBindings deduplication and sorting', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '127.0.0.1');

	// Get bindings for the port
	const bindings = await portBindings(port, {host: '*'});

	// Should not have duplicate (host, pid) combinations
	const seen = new Set();
	for (const binding of bindings) {
		const key = `${binding.host}|${binding.pid}`;
		assert.ok(!seen.has(key), `Duplicate binding found: ${key}`);
		seen.add(key);
	}

	// Should have at least one binding for our process
	assert.ok(bindings.some(binding => binding.pid === process.pid));

	// Test sorting (localhost should come first)
	const firstLocalhost = bindings.findIndex(binding => binding.host === '127.0.0.1' || binding.host === '::1');
	const firstNonLocalhost = bindings.findIndex(binding => binding.host !== '127.0.0.1' && binding.host !== '::1');
	if (firstLocalhost !== -1 && firstNonLocalhost !== -1) {
		// If we have both types, localhost should come first
		assert.ok(firstLocalhost < firstNonLocalhost, 'Localhost should come before non-localhost');
	}
});

test('multi-port API basic functionality', {timeout: testTimeout}, async t => {
	const [port1, port2] = await Promise.all([getPort(), getPort()]);
	await Promise.all([
		startServer(t, port1, '127.0.0.1'),
		startServer(t, port2, '127.0.0.1'),
	]);

	// Should work with multiple ports
	const result = await portToPid([port1, port2]);
	assert.equal(result.get(port1), process.pid);
	assert.equal(result.get(port2), process.pid);
});

test('comprehensive error message consistency', {timeout: testTimeout}, async () => {
	const unusedPort = await getPort();

	// Single port error (default localhost)
	await assert.rejects(
		portToPid(unusedPort),
		{message: `Could not find a process that uses port \`${unusedPort}\` on localhost`},
	);

	// With specific host
	await assert.rejects(
		portToPid({port: unusedPort, host: '192.168.1.1'}),
		{message: `Could not find a process that uses port \`${unusedPort}\` on host \`192.168.1.1\``},
	);

	// With wildcard host
	await assert.rejects(
		portToPid({port: unusedPort, host: '*'}),
		{message: `Could not find a process that uses port \`${unusedPort}\``},
	);

	// PortBindings should have slightly different message
	await assert.rejects(
		portBindings(unusedPort),
		{message: `Could not find any processes using port \`${unusedPort}\` on localhost`},
	);
});

test('pidToPorts returns ports from all interfaces', {timeout: testTimeout}, async t => {
	const port1 = await getPort();
	const port2 = await getPort();

	// Create servers on different interfaces
	await startServer(t, port1, '127.0.0.1');
	await startServer(t, port2);

	// PidToPorts should return ALL ports for the process, regardless of interface
	const ports = await pidToPorts(process.pid);
	assert.ok(ports.has(port1), 'Should include localhost-only port');
	assert.ok(ports.has(port2), 'Should include all-interfaces port');

	// Test multi-PID version
	const multiResult = await pidToPorts([process.pid]);
	const myPorts = multiResult.get(process.pid);
	assert.ok(myPorts.has(port1));
	assert.ok(myPorts.has(port2));
});

test('allPortsWithPid host filtering variants', {timeout: testTimeout}, async t => {
	const port = await getPort();
	await startServer(t, port, '127.0.0.1');

	// Default (localhost only)
	const localhost = await allPortsWithPid();
	assert.ok(localhost.has(port));

	// Explicit localhost variants
	const explicitLocalhost = await allPortsWithPid({host: 'localhost'});
	assert.ok(explicitLocalhost.has(port));

	const ipLocalhost = await allPortsWithPid({host: '127.0.0.1'});
	assert.ok(ipLocalhost.has(port));

	// All interfaces
	const all = await allPortsWithPid({host: '*'});
	assert.ok(all.has(port));

	// Should have at least as many ports in 'all' as in 'localhost'
	assert.ok(all.size >= localhost.size);
});
