import process from 'node:process';
import http from 'node:http';
import test from 'ava';
import getPort from 'get-port';
import {portToPid, pidToPorts, allPortsWithPid, portBindings} from './index.js';

const createServer = () => http.createServer((request, response) => {
	response.end();
});

const startServer = async (port, host = '127.0.0.1') => {
	const server = createServer().listen(port, host);
	await new Promise(resolve => {
		server.on('listening', resolve);
	});
	return server;
};

test('portToPid()', async t => {
	const port = await getPort();
	const server = await startServer(port);
	t.is(await portToPid(port), process.pid);
	server.close();
});

test('fail', async t => {
	await t.throwsAsync(portToPid(0), {message: 'Expected a TCP/UDP port between 1 and 65535, got 0'});
	await t.throwsAsync(portToPid([0]), {message: 'Expected port to be an integer between 1 and 65535, got 0'});
});

test('accepts an integer', async t => {
	await t.throwsAsync(portToPid('foo'), {message: 'Expected a TCP/UDP port between 1 and 65535, got foo'});
	await t.throwsAsync(portToPid(0.5), {message: 'Expected a TCP/UDP port between 1 and 65535, got 0.5'});
});

test('multiple', async t => {
	const [port1, port2] = await Promise.all([getPort(), getPort()]);
	const [server1, server2] = await Promise.all([
		startServer(port1),
		startServer(port2),
	]);

	const ports = await portToPid([port1, port2]);

	t.true(ports instanceof Map);

	for (const port of ports.values()) {
		t.is(typeof port, 'number');
	}

	server1.close();
	server2.close();
});

test('pidToPorts()', async t => {
	const [firstPort, secondPort] = await Promise.all([getPort(), getPort()]);
	const [firstServer, secondServer] = await Promise.all([
		startServer(firstPort),
		startServer(secondPort),
	]);

	const portsToCheck = [firstPort, secondPort];

	const pidPorts = await pidToPorts(process.pid);

	for (const port of portsToCheck) {
		t.true(pidPorts.has(port));
	}

	const ports = await pidToPorts([process.pid]);
	const pidsPorts = ports.get(process.pid);

	for (const port of portsToCheck) {
		t.true(pidsPorts.has(port));
	}

	firstServer.close();
	secondServer.close();
});

test('allPortsWithPid()', async t => {
	const all = await allPortsWithPid();
	t.true(all instanceof Map);

	// Test that we can resolve localhost ports with predictable behavior
	const localhostPorts = [...all.keys()].slice(0, 3);

	const results = await Promise.allSettled(localhostPorts.map(async port => portToPid({port, host: '*'})));

	for (const result of results) {
		// All should succeed when explicitly checking all interfaces
		t.is(result.status, 'fulfilled');
		t.is(typeof result.value, 'number');
	}
});

test('host option with single host', async t => {
	const port = await getPort();
	const server = await startServer(port);

	// Test options object API
	const pid1 = await portToPid({port, host: '127.0.0.1'});
	t.is(pid1, process.pid);

	// Test without host (should also work)
	const pid2 = await portToPid({port});
	t.is(pid2, process.pid);

	server.close();
});

test('host option error handling', async t => {
	const port = await getPort();
	const server = await startServer(port);

	// Test with non-existent host
	await t.throwsAsync(
		portToPid({port, host: '192.168.999.999'}),
		{message: `Could not find a process that uses port \`${port}\` on host \`192.168.999.999\``},
	);

	// Test invalid host type
	await t.throwsAsync(
		portToPid({port, host: 123}),
		{message: 'Expected host to be a string, got number'},
	);

	server.close();
});

test('predictable port selection', async t => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// PortToPid should return predictable result (sorted by host)
	const pid = await portToPid(port);
	t.is(pid, process.pid);

	// Explicit host should also work
	const pidWithHost = await portToPid({port, host: '127.0.0.1'});
	t.is(pidWithHost, process.pid);

	// PortBindings should show localhost bindings
	const bindings = await portBindings(port);
	t.true(bindings.length > 0);
	t.true(bindings.some(b => b.pid === process.pid && b.host === '127.0.0.1'));

	server.close();
});

test('allPortsWithPid with host filter', async t => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Test without host filter
	const all = await allPortsWithPid();
	t.true(all.has(port));

	// Test with host filter
	const filtered = await allPortsWithPid({host: '127.0.0.1'});
	t.true(filtered.has(port));
	t.is(filtered.get(port), process.pid);

	// Test with non-existent host
	const empty = await allPortsWithPid({host: '192.168.999.999'});
	t.false(empty.has(port));

	server.close();
});

test('portBindings', async t => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Test getting localhost bindings (default)
	const bindings = await portBindings(port);
	t.true(Array.isArray(bindings));
	t.true(bindings.length > 0);

	// Should have our binding
	const ourBinding = bindings.find(b => b.pid === process.pid);
	t.truthy(ourBinding);
	t.is(ourBinding.host, '127.0.0.1');

	// Test with all interfaces
	const allBindings = await portBindings(port, {host: '*'});
	t.true(allBindings.length >= bindings.length);

	// Test with invalid port (out of range)
	await t.throwsAsync(
		portBindings(99_999),
		{message: 'Expected a TCP/UDP port between 1 and 65535, got 99999'},
	);

	server.close();
});

test('sorting is predictable', async t => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Multiple calls should return same result (predictable sorting)
	const result1 = await portToPid(port);
	const result2 = await portToPid(port);
	t.is(result1, result2);

	// Bindings should be sorted by host
	const bindings = await portBindings(port);
	if (bindings.length > 1) {
		for (let i = 1; i < bindings.length; i++) {
			t.true(bindings[i - 1].host.localeCompare(bindings[i].host) <= 0);
		}
	}

	server.close();
});

test('portToPid unified API', async t => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Test both API styles work identically
	const pidDirect = await portToPid(port);
	const pidOptions = await portToPid({port});
	t.is(pidDirect, pidOptions);
	t.is(pidDirect, process.pid);

	// Test with host specified
	const pidWithHost = await portToPid({port, host: '127.0.0.1'});
	t.is(pidWithHost, process.pid);

	server.close();
});

test('error messages', async t => {
	// Test validation errors first
	await t.throwsAsync(
		portToPid(99_999),
		{message: 'Expected a TCP/UDP port between 1 and 65535, got 99999'},
	);

	await t.throwsAsync(
		portToPid('not-a-number'),
		{message: 'Expected a TCP/UDP port between 1 and 65535, got not-a-number'},
	);

	await t.throwsAsync(
		portToPid({port: 'not-a-number'}),
		{message: 'Expected port to be an integer between 1 and 65535, got not-a-number'},
	);

	// Test runtime errors with valid ports that aren't in use
	const unusedPort = await getPort();
	await t.throwsAsync(
		portToPid(unusedPort),
		{message: `Could not find a process that uses port \`${unusedPort}\` on localhost`},
	);

	await t.throwsAsync(
		portToPid({port: unusedPort, host: '127.0.0.1'}),
		{message: `Could not find a process that uses port \`${unusedPort}\` on host \`127.0.0.1\``},
	);

	await t.throwsAsync(
		portToPid({port: unusedPort, host: '*'}),
		{message: `Could not find a process that uses port \`${unusedPort}\``},
	);
});

test('IPv6 localhost support', async t => {
	const port = await getPort();
	const server = await startServer(port, '::1');

	// Should find the process on IPv6 localhost
	const pid = await portToPid(port);
	t.is(pid, process.pid);

	// Should also work with explicit IPv6 localhost
	const pidExplicit = await portToPid({port, host: '::1'});
	t.is(pidExplicit, process.pid);

	server.close();
});

test('host regex escaping', async t => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Test that dots in host are treated literally, not as regex wildcards
	// If regex escaping is broken, '127x0x0x1' might incorrectly match '127.0.0.1'
	await t.throwsAsync(
		portToPid({port, host: '127x0x0x1'}),
		{message: `Could not find a process that uses port \`${port}\` on host \`127x0x0x1\``},
	);

	// But the correct host should work
	const pid = await portToPid({port, host: '127.0.0.1'});
	t.is(pid, process.pid);

	server.close();
});

test('edge case host values', async t => {
	const port = await getPort();

	// Test empty string host
	await t.throwsAsync(
		portToPid({port, host: ''}),
		{message: `Could not find a process that uses port \`${port}\` on host \`\``},
	);

	// Test invalid host type
	await t.throwsAsync(
		portToPid({port, host: 123}),
		{message: 'Expected host to be a string, got number'},
	);
});

test('allPortsWithPid localhost-only default', async t => {
	const port1 = await getPort();
	const port2 = await getPort();

	// Create one localhost server and get one all-interfaces server
	const localhostServer = createServer().listen(port1, '127.0.0.1');
	const allServer = createServer().listen(port2); // Binds to all interfaces

	await Promise.all([
		new Promise(resolve => {
			localhostServer.on('listening', resolve);
		}),
		new Promise(resolve => {
			allServer.on('listening', resolve);
		}),
	]);

	// Default should only return localhost ports
	const localhostPorts = await allPortsWithPid();
	t.true(localhostPorts.has(port1)); // Should have localhost port
	t.false(localhostPorts.has(port2)); // Should NOT have all-interfaces port

	// Explicit all interfaces should return both
	const allPorts = await allPortsWithPid({host: '*'});
	t.true(allPorts.has(port1)); // Should have localhost port
	t.true(allPorts.has(port2)); // Should have all-interfaces port

	localhostServer.close();
	allServer.close();
});

test('validation error handling', async t => {
	// Test pidToPorts with invalid PID
	await t.throwsAsync(
		pidToPorts('not-a-number'),
		{message: 'Expected an integer, got string'},
	);

	await t.throwsAsync(
		pidToPorts(1.5),
		{message: 'Expected an integer, got number'},
	);

	// Test portBindings with invalid port
	await t.throwsAsync(
		portBindings('not-a-number'),
		{message: 'Expected a TCP/UDP port between 1 and 65535, got not-a-number'},
	);

	await t.throwsAsync(
		portBindings(0),
		{message: 'Expected a TCP/UDP port between 1 and 65535, got 0'},
	);

	await t.throwsAsync(
		portBindings(70_000),
		{message: 'Expected a TCP/UDP port between 1 and 65535, got 70000'},
	);

	// Test allPortsWithPid with invalid host
	await t.throwsAsync(
		allPortsWithPid({host: 123}),
		{message: 'Expected host to be a string, got number'},
	);

	// Test portToPid with invalid port in options
	await t.throwsAsync(
		portToPid({port: 0}),
		{message: 'Expected port to be an integer between 1 and 65535, got 0'},
	);

	await t.throwsAsync(
		portToPid({port: 70_000}),
		{message: 'Expected port to be an integer between 1 and 65535, got 70000'},
	);

	await t.throwsAsync(
		portToPid({port: 8080, host: 123}),
		{message: 'Expected host to be a string, got number'},
	);
});

test('pidToPorts returns all interfaces', async t => {
	const port1 = await getPort();
	const port2 = await getPort();

	// Create servers on different interfaces
	const localhostServer = createServer().listen(port1, '127.0.0.1');
	const allServer = createServer().listen(port2); // All interfaces

	await Promise.all([
		new Promise(resolve => {
			localhostServer.on('listening', resolve);
		}),
		new Promise(resolve => {
			allServer.on('listening', resolve);
		}),
	]);

	// PidToPorts should return ALL ports for the process, regardless of interface
	const ports = await pidToPorts(process.pid);
	t.true(ports.has(port1)); // Should have localhost port
	t.true(ports.has(port2)); // Should have all-interfaces port

	localhostServer.close();
	allServer.close();
});

test('IPv6 bracket stripping behavior', async t => {
	const port = await getPort();
	const server = createServer().listen(port, '::1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Windows might return bracketed IPv6 addresses - our parsing should handle it
	// Test that {host: '::1'} works correctly for finding IPv6 localhost
	const pid = await portToPid({port, host: '::1'});
	t.is(pid, process.pid);

	// Test that portBindings returns clean IPv6 without brackets
	const bindings = await portBindings(port);
	const ipv6Binding = bindings.find(binding => binding.host.includes(':'));
	if (ipv6Binding) {
		// Should not have brackets if we're properly stripping them
		t.false(ipv6Binding.host.startsWith('['));
		t.false(ipv6Binding.host.endsWith(']'));
	}

	server.close();
});

test('localhost keyword explicit support', async t => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Test that explicit 'localhost' string works as host filter
	const pid = await portToPid({port, host: 'localhost'});
	t.is(pid, process.pid);

	const bindings = await portBindings(port, {host: 'localhost'});
	t.true(bindings.length > 0);
	t.true(bindings.some(binding => binding.pid === process.pid));

	server.close();
});

test('IPv6 host filtering without brackets', async t => {
	const port = await getPort();
	const server = createServer().listen(port, '::1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Should work with IPv6 localhost
	const pid = await portToPid({port, host: '::1'});
	t.is(pid, process.pid);

	// Should also work with default localhost filter
	const pidDefault = await portToPid(port);
	t.is(pidDefault, process.pid);

	// Test that portBindings returns unbracketed IPv6
	const bindings = await portBindings(port);
	t.true(bindings.some(binding => binding.host === '::1'));

	server.close();
});

test('multiple ports with missing port handling', async t => {
	const [usedPort, unusedPort] = await Promise.all([getPort(), getPort()]);
	const server = await startServer(usedPort);

	// Should throw on first missing port
	await t.throwsAsync(
		portToPid([usedPort, unusedPort]),
		{message: /Could not find a process that uses port/},
	);

	server.close();
});

test('host normalization and wildcard support', async t => {
	const port = await getPort();
	const server = await startServer(port, '127.0.0.1');

	// 'localhost' should normalize to '127.0.0.1'
	const pidLocalhost = await portToPid({port, host: 'localhost'});
	t.is(pidLocalhost, process.pid);

	// Should work with explicit '127.0.0.1'
	const pidExplicit = await portToPid({port, host: '127.0.0.1'});
	t.is(pidExplicit, process.pid);

	// Test wildcard on all interfaces server
	server.close();
	const allServer = createServer().listen(port);
	await new Promise(resolve => {
		allServer.on('listening', resolve);
	});

	// '*' and '0.0.0.0' should work as wildcards
	const wildcard1 = await portToPid({port, host: '*'});
	t.is(wildcard1, process.pid);

	const wildcard2 = await portToPid({port, host: '0.0.0.0'});
	t.is(wildcard2, process.pid);

	allServer.close();
});

test('portBindings deduplication and sorting', async t => {
	const port = await getPort();
	const server = await startServer(port);

	// Get bindings for the port
	const bindings = await portBindings(port, {host: '*'});

	// Should not have duplicate (host, pid) combinations
	const seen = new Set();
	for (const binding of bindings) {
		const key = `${binding.host}|${binding.pid}`;
		t.false(seen.has(key), `Duplicate binding found: ${key}`);
		seen.add(key);
	}

	// Should have at least one binding for our process
	t.true(bindings.some(b => b.pid === process.pid));

	// Test sorting (localhost should come first)
	if (bindings.length > 1) {
		const localhostBindings = bindings.filter(b => b.host === '127.0.0.1' || b.host === '::1');
		const nonLocalhostBindings = bindings.filter(b => b.host !== '127.0.0.1' && b.host !== '::1');

		// If we have both types, localhost should come first
		if (localhostBindings.length > 0 && nonLocalhostBindings.length > 0) {
			const firstLocalhost = bindings.findIndex(b => b.host === '127.0.0.1' || b.host === '::1');
			const firstNonLocalhost = bindings.findIndex(b => b.host !== '127.0.0.1' && b.host !== '::1');
			t.true(firstLocalhost < firstNonLocalhost, 'Localhost should come before non-localhost');
		}
	}

	server.close();
});

test('multi-port API basic functionality', async t => {
	const [port1, port2] = await Promise.all([getPort(), getPort()]);
	const [server1, server2] = await Promise.all([
		startServer(port1),
		startServer(port2),
	]);

	// Should work with multiple ports
	const result = await portToPid([port1, port2]);
	t.is(result.get(port1), process.pid);
	t.is(result.get(port2), process.pid);

	server1.close();
	server2.close();
});

test('comprehensive error message consistency', async t => {
	const unusedPort = await getPort();

	// Single port error (default localhost)
	await t.throwsAsync(
		portToPid(unusedPort),
		{message: `Could not find a process that uses port \`${unusedPort}\` on localhost`},
	);

	// With specific host
	await t.throwsAsync(
		portToPid({port: unusedPort, host: '192.168.1.1'}),
		{message: `Could not find a process that uses port \`${unusedPort}\` on host \`192.168.1.1\``},
	);

	// With wildcard host
	await t.throwsAsync(
		portToPid({port: unusedPort, host: '*'}),
		{message: `Could not find a process that uses port \`${unusedPort}\``},
	);

	// PortBindings should have slightly different message
	await t.throwsAsync(
		portBindings(unusedPort),
		{message: `Could not find any processes using port \`${unusedPort}\` on localhost`},
	);
});

test('pidToPorts returns ports from all interfaces', async t => {
	const [port1, port2] = await Promise.all([getPort(), getPort()]);

	// Create servers on different interfaces
	const localhostServer = await startServer(port1, '127.0.0.1');
	const allServer = createServer().listen(port2); // All interfaces

	await new Promise(resolve => {
		allServer.on('listening', resolve);
	});

	// PidToPorts should return ALL ports for the process, regardless of interface
	const ports = await pidToPorts(process.pid);
	t.true(ports.has(port1), 'Should include localhost-only port');
	t.true(ports.has(port2), 'Should include all-interfaces port');

	// Test multi-PID version
	const multiResult = await pidToPorts([process.pid]);
	const myPorts = multiResult.get(process.pid);
	t.true(myPorts.has(port1));
	t.true(myPorts.has(port2));

	localhostServer.close();
	allServer.close();
});

test('allPortsWithPid host filtering variants', async t => {
	const port = await getPort();
	const server = await startServer(port);

	// Default (localhost only)
	const localhost = await allPortsWithPid();
	t.true(localhost.has(port));

	// Explicit localhost variants
	const explicitLocalhost = await allPortsWithPid({host: 'localhost'});
	t.true(explicitLocalhost.has(port));

	const ipLocalhost = await allPortsWithPid({host: '127.0.0.1'});
	t.true(ipLocalhost.has(port));

	// All interfaces
	const all = await allPortsWithPid({host: '*'});
	t.true(all.has(port));

	// Should have at least as many ports in 'all' as in 'localhost'
	t.true(all.size >= localhost.size);

	server.close();
});
