import http from 'http';
import {serial as test} from 'ava';
import getPort from 'get-port';
import pidPort from '.';
import execa from 'execa';

const createServer = () => http.createServer((request, response) => {
	response.end();
});

const forkServer = (t, port, host) => {
	return new Promise(resolve => {
		const server = execa.node('t-server.js', [port, host]);
		t.context.forkedServers.push(server);
		server.once('message', () => resolve({server}));
	});
};

const closeFork = async server => {
	try {
		server.cancel();
		await server;
	} catch (error) {
		if (!error.isCanceled) {
			console.error(error);
		}
	}
};

test.beforeEach(t => {
	t.context.forkedServers = [];
});

test.afterEach(async t => {
	const results = [];
	for (const server of t.context.forkedServers) {
		results.push(closeFork(server));
	}

	await Promise.all(results);
});

test('success', async t => {
	const port = await getPort();
	const server = createServer().listen(port);
	t.is(await pidPort.portToPid(port), process.pid);
	server.close();
});

test('fail', async t => {
	await t.throwsAsync(pidPort.portToPid(0), {message: 'Could not find a process that uses port `0`'});
	await t.throwsAsync(pidPort.portToPid([0]), {message: 'Could not find a process that uses port `0`'});
});

test('accepts an integer', async t => {
	await t.throwsAsync(pidPort.portToPid('foo'), {message: 'Expected an integer, got string'});
	await t.throwsAsync(pidPort.portToPid(0.5), {message: 'Expected an integer, got number'});
});

test('accepts a list input', async t => {
	const [port1, port2] = await Promise.all([getPort(), getPort()]);
	const [server1, server2] = [createServer().listen(port1), createServer().listen(port2)];
	const ports = await pidPort.portToPid([port1, port2]);

	t.true(ports instanceof Map);

	for (const port of ports.values()) {
		t.is(typeof port, 'number');
	}

	server1.close();
	server2.close();
});

test('`.pidToPorts()`', async t => {
	const firstPort = await getPort();
	const firstServer = createServer().listen(firstPort);

	const secondPort = await getPort();
	const secondServer = createServer().listen(secondPort);

	const portsToCheck = [firstPort, secondPort];

	const pidPorts = await pidPort.pidToPorts(process.pid);

	for (const port of portsToCheck) {
		t.true(pidPorts.has(port));
	}

	const pidsPorts = (await pidPort.pidToPorts([process.pid])).get(process.pid);

	for (const port of portsToCheck) {
		t.true(pidsPorts.has(port));
	}

	firstServer.close();
	secondServer.close();
});

test('`.all()`', async t => {
	const all = await pidPort.all();
	t.true(all instanceof Map);
	await t.notThrowsAsync(pidPort.portToPid([...all.keys()]));
});

test('`.all(host) - 2 hosts same port`', async t => {
	const port = await getPort();
	const host1 = '127.0.0.1';
	const host2 = '127.0.0.2';

	const {server: server1} = await forkServer(t, port, host1);
	const {server: server2} = await forkServer(t, port, host2);

	const host1Ports = await pidPort.all(host1);
	t.is(host1Ports.get(port), server1.pid);

	const host2Ports = await pidPort.all(host2);
	t.is(host2Ports.get(port), server2.pid);
});

test('API ISSUE `.all()` - same port 2 ips', async t => {
	const port = await getPort();
	const {server: server1} = await forkServer(t, port, '127.0.0.1');
	const {server: server2} = await forkServer(t, port, '127.0.0.2');
	const all = await pidPort.all();
	t.is(all.get(port), server1.pid);
	t.is(all.get(port), server2.pid);
});

test('Node `server.listen()` signature - with options object', async t => {
	const port = await getPort();
	const host = '127.0.0.2';
	const server = createServer().listen({port, host});
	t.is(await pidPort.portToPid({port, host}), process.pid);
	server.close();
});
