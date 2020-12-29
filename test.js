import http from 'http';
import {serial as test} from 'ava';
import getPort from 'get-port';
import pidPort from '.';

const createServer = () => http.createServer((request, response) => {
	response.end();
});

test('success', async t => {
	const port = await getPort();
	const server = createServer().listen(port);
	t.truthy(await pidPort.portToPid(port));
	server.close();
});

test('fail', async t => {
	await t.throwsAsync(pidPort.portToPid(0), {message: 'Could not find a process that uses port `0`'});
	await t.throwsAsync(pidPort.portToPid([0]), {message: 'Could not find a process that uses port `0`'});
});

test('accepts a number', async t => {
	await t.throwsAsync(pidPort.portToPid('foo'), {message: 'Expected port to be a number, got string'});
});

test('`.all()`', async t => {
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

test('`.list()`', async t => {
	const all = await pidPort.all();
	t.true(all instanceof Map);
	await t.notThrowsAsync(pidPort.portToPid([...all.keys()]));
});

test('Node `server.listen()` signature - with different host as arg', async t => {
	const port = await getPort();
	const host = '127.0.0.2';
	const server = createServer().listen(port, host);
	t.truthy(await pidPort.portToPid(port, host));
	server.close();
});

test('Node `server.listen()` signature - with object arg', async t => {
	const port = await getPort();
	const host = '127.0.0.2';
	const server = createServer().listen({port, host});
	t.truthy(await pidPort.portToPid({port, host}));
	server.close();
});
