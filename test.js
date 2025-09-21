import process from 'node:process';
import http from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import getPort from 'get-port';
import {
	portToPid,
	pidToPorts,
	allPortsWithPid,
	portBindings,
} from './index.js';

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

test('portToPid()', async () => {
	const port = await getPort();
	const server = await startServer(port);
	assert.equal(await portToPid(port), process.pid);
	server.close();
});

test('fail', async () => {
	await assert.rejects(portToPid(0), {message: 'Expected a TCP/UDP port between 1 and 65535, got 0'});
	await assert.rejects(portToPid([0]), {message: 'Expected port to be an integer between 1 and 65535, got 0'});
});

test('accepts an integer', async () => {
	await assert.rejects(portToPid('foo'), {message: 'Expected a TCP/UDP port between 1 and 65535, got foo'});
	await assert.rejects(portToPid(0.5), {message: 'Expected a TCP/UDP port between 1 and 65535, got 0.5'});
});

test('multiple', async () => {
	const [port1, port2] = await Promise.all([getPort(), getPort()]);
	const [server1, server2] = await Promise.all([
		startServer(port1),
		startServer(port2),
	]);

	const ports = await portToPid([port1, port2]);

	assert.ok(ports instanceof Map);

	for (const port of ports.values()) {
		assert.equal(typeof port, 'number');
	}

	server1.close();
	server2.close();
});

test('pidToPorts()', async () => {
	const [firstPort, secondPort] = await Promise.all([getPort(), getPort()]);
	const [firstServer, secondServer] = await Promise.all([
		startServer(firstPort),
		startServer(secondPort),
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

	firstServer.close();
	secondServer.close();
});

test('allPortsWithPid()', async () => {
	const all = await allPortsWithPid();
	assert.ok(all instanceof Map);

	// Test that we can resolve localhost ports with predictable behavior
	const localhostPorts = [...all.keys()].slice(0, 3);

	const results = await Promise.allSettled(localhostPorts.map(async port => portToPid({port, host: '*'})));

	for (const result of results) {
		// All should succeed when explicitly checking all interfaces
		assert.equal(result.status, 'fulfilled');
		assert.equal(typeof result.value, 'number');
	}
});

test('host option with single host', async () => {
	const port = await getPort();
	const server = await startServer(port);

	// Test options object API
	const pid1 = await portToPid({port, host: '127.0.0.1'});
	assert.equal(pid1, process.pid);

	// Test without host (should also work)
	const pid2 = await portToPid({port});
	assert.equal(pid2, process.pid);

	server.close();
});

test('host option error handling', async () => {
	const port = await getPort();
	const server = await startServer(port);

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

	server.close();
});

test('predictable port selection', async () => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// PortToPid should return predictable result (sorted by host)
	const pid = await portToPid(port);
	assert.equal(pid, process.pid);

	// Explicit host should also work
	const pidWithHost = await portToPid({port, host: '127.0.0.1'});
	assert.equal(pidWithHost, process.pid);

	// PortBindings should show localhost bindings
	const bindings = await portBindings(port);
	assert.ok(bindings.length > 0);
	assert.ok(bindings.some(b => b.pid === process.pid && b.host === '127.0.0.1'));

	server.close();
});

test('allPortsWithPid with host filter', async () => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

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

	server.close();
});

test('portBindings', async () => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Test getting localhost bindings (default)
	const bindings = await portBindings(port);
	assert.ok(Array.isArray(bindings));
	assert.ok(bindings.length > 0);

	// Should have our binding
	const ourBinding = bindings.find(b => b.pid === process.pid);
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

	server.close();
});

test('sorting is predictable', async () => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Multiple calls should return same result (predictable sorting)
	const result1 = await portToPid(port);
	const result2 = await portToPid(port);
	assert.equal(result1, result2);

	// Bindings should be sorted by host
	const bindings = await portBindings(port);
	if (bindings.length > 1) {
		for (let i = 1; i < bindings.length; i++) {
			assert.ok(bindings[i - 1].host.localeCompare(bindings[i].host) <= 0);
		}
	}

	server.close();
});

test('portToPid unified API', async () => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Test both API styles work identically
	const pidDirect = await portToPid(port);
	const pidOptions = await portToPid({port});
	assert.equal(pidDirect, pidOptions);
	assert.equal(pidDirect, process.pid);

	// Test with host specified
	const pidWithHost = await portToPid({port, host: '127.0.0.1'});
	assert.equal(pidWithHost, process.pid);

	server.close();
});

test('error messages', async () => {
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

test('IPv6 localhost support', async () => {
	const port = await getPort();
	const server = await startServer(port, '::1');

	// Should find the process on IPv6 localhost
	const pid = await portToPid(port);
	assert.equal(pid, process.pid);

	// Should also work with explicit IPv6 localhost
	const pidExplicit = await portToPid({port, host: '::1'});
	assert.equal(pidExplicit, process.pid);

	server.close();
});

test('host regex escaping', async () => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Test that dots in host are treated literally, not as regex wildcards
	// If regex escaping is broken, '127x0x0x1' might incorrectly match '127.0.0.1'
	await assert.rejects(
		portToPid({port, host: '127x0x0x1'}),
		{message: `Could not find a process that uses port \`${port}\` on host \`127x0x0x1\``},
	);

	// But the correct host should work
	const pid = await portToPid({port, host: '127.0.0.1'});
	assert.equal(pid, process.pid);

	server.close();
});

test('edge case host values', async () => {
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

test('allPortsWithPid localhost-only default', async () => {
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
	assert.ok(localhostPorts.has(port1)); // Should have localhost port
	assert.ok(!localhostPorts.has(port2)); // Should NOT have all-interfaces port

	// Explicit all interfaces should return both
	const allPorts = await allPortsWithPid({host: '*'});
	assert.ok(allPorts.has(port1)); // Should have localhost port
	assert.ok(allPorts.has(port2)); // Should have all-interfaces port

	localhostServer.close();
	allServer.close();
});

test('validation error handling', async () => {
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

test('pidToPorts returns all interfaces', async () => {
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
	assert.ok(ports.has(port1)); // Should have localhost port
	assert.ok(ports.has(port2)); // Should have all-interfaces port

	localhostServer.close();
	allServer.close();
});

test('IPv6 bracket stripping behavior', async () => {
	const port = await getPort();
	const server = createServer().listen(port, '::1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Windows might return bracketed IPv6 addresses - our parsing should handle it
	// Test that {host: '::1'} works correctly for finding IPv6 localhost
	const pid = await portToPid({port, host: '::1'});
	assert.equal(pid, process.pid);

	// Test that portBindings returns clean IPv6 without brackets
	const bindings = await portBindings(port);
	const ipv6Binding = bindings.find(binding => binding.host.includes(':'));
	if (ipv6Binding) {
		// Should not have brackets if we're properly stripping them
		assert.ok(!ipv6Binding.host.startsWith('['));
		assert.ok(!ipv6Binding.host.endsWith(']'));
	}

	server.close();
});

test('localhost keyword explicit support', async () => {
	const port = await getPort();
	const server = createServer().listen(port, '127.0.0.1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Test that explicit 'localhost' string works as host filter
	const pid = await portToPid({port, host: 'localhost'});
	assert.equal(pid, process.pid);

	const bindings = await portBindings(port, {host: 'localhost'});
	assert.ok(bindings.length > 0);
	assert.ok(bindings.some(binding => binding.pid === process.pid));

	server.close();
});

test('IPv6 host filtering without brackets', async () => {
	const port = await getPort();
	const server = createServer().listen(port, '::1');

	await new Promise(resolve => {
		server.on('listening', resolve);
	});

	// Should work with IPv6 localhost
	const pid = await portToPid({port, host: '::1'});
	assert.equal(pid, process.pid);

	// Should also work with default localhost filter
	const pidDefault = await portToPid(port);
	assert.equal(pidDefault, process.pid);

	// Test that portBindings returns unbracketed IPv6
	const bindings = await portBindings(port);
	assert.ok(bindings.some(binding => binding.host === '::1'));

	server.close();
});

test('multiple ports with missing port handling', async () => {
	const [usedPort, unusedPort] = await Promise.all([getPort(), getPort()]);
	const server = await startServer(usedPort);

	// Should throw on first missing port
	await assert.rejects(
		portToPid([usedPort, unusedPort]),
		{message: /Could not find a process that uses port/},
	);

	server.close();
});

test('host normalization and wildcard support', async () => {
	const port = await getPort();
	const server = await startServer(port, '127.0.0.1');

	// 'localhost' should normalize to '127.0.0.1'
	const pidLocalhost = await portToPid({port, host: 'localhost'});
	assert.equal(pidLocalhost, process.pid);

	// Should work with explicit '127.0.0.1'
	const pidExplicit = await portToPid({port, host: '127.0.0.1'});
	assert.equal(pidExplicit, process.pid);

	// Test wildcard on all interfaces server
	server.close();
	const allServer = createServer().listen(port);
	await new Promise(resolve => {
		allServer.on('listening', resolve);
	});

	// '*' and '0.0.0.0' should work as wildcards
	const wildcard1 = await portToPid({port, host: '*'});
	assert.equal(wildcard1, process.pid);

	const wildcard2 = await portToPid({port, host: '0.0.0.0'});
	assert.equal(wildcard2, process.pid);

	allServer.close();
});

test('portBindings deduplication and sorting', async () => {
	const port = await getPort();
	const server = await startServer(port);

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
	assert.ok(bindings.some(b => b.pid === process.pid));

	// Test sorting (localhost should come first)
	if (bindings.length > 1) {
		const localhostBindings = bindings.filter(b => b.host === '127.0.0.1' || b.host === '::1');
		const nonLocalhostBindings = bindings.filter(b => b.host !== '127.0.0.1' && b.host !== '::1');

		// If we have both types, localhost should come first
		if (localhostBindings.length > 0 && nonLocalhostBindings.length > 0) {
			const firstLocalhost = bindings.findIndex(b => b.host === '127.0.0.1' || b.host === '::1');
			const firstNonLocalhost = bindings.findIndex(b => b.host !== '127.0.0.1' && b.host !== '::1');
			assert.ok(firstLocalhost < firstNonLocalhost, 'Localhost should come before non-localhost');
		}
	}

	server.close();
});

test('multi-port API basic functionality', async () => {
	const [port1, port2] = await Promise.all([getPort(), getPort()]);
	const [server1, server2] = await Promise.all([
		startServer(port1),
		startServer(port2),
	]);

	// Should work with multiple ports
	const result = await portToPid([port1, port2]);
	assert.equal(result.get(port1), process.pid);
	assert.equal(result.get(port2), process.pid);

	server1.close();
	server2.close();
});

test('comprehensive error message consistency', async () => {
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

test('pidToPorts returns ports from all interfaces', async () => {
	const [port1, port2] = await Promise.all([getPort(), getPort()]);

	// Create servers on different interfaces
	const localhostServer = await startServer(port1, '127.0.0.1');
	const allServer = createServer().listen(port2); // All interfaces

	await new Promise(resolve => {
		allServer.on('listening', resolve);
	});

	// PidToPorts should return ALL ports for the process, regardless of interface
	const ports = await pidToPorts(process.pid);
	assert.ok(ports.has(port1), 'Should include localhost-only port');
	assert.ok(ports.has(port2), 'Should include all-interfaces port');

	// Test multi-PID version
	const multiResult = await pidToPorts([process.pid]);
	const myPorts = multiResult.get(process.pid);
	assert.ok(myPorts.has(port1));
	assert.ok(myPorts.has(port2));

	localhostServer.close();
	allServer.close();
});

test('allPortsWithPid host filtering variants', async () => {
	const port = await getPort();
	const server = await startServer(port);

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

	server.close();
});
