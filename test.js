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
