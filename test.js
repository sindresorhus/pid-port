import process from 'node:process';
import http from 'node:http';
import test from 'ava';
import getPort from 'get-port';
import {portToPid, pidToPorts, allPortsWithPid} from './index.js';

const createServer = () => http.createServer((request, response) => {
	response.end();
});

test('portToPid()', async t => {
	const port = await getPort();
	const server = createServer().listen(port);
	t.is(await portToPid(port), process.pid);
	server.close();
});

test('fail', async t => {
	await t.throwsAsync(portToPid(0), {message: 'Could not find a process that uses port `0`'});
	await t.throwsAsync(portToPid([0]), {message: 'Could not find a process that uses port `0`'});
});

test('accepts an integer', async t => {
	await t.throwsAsync(portToPid('foo'), {message: 'Expected an integer, got string'});
	await t.throwsAsync(portToPid(0.5), {message: 'Expected an integer, got number'});
});

test('multiple', async t => {
	const [port1, port2] = await Promise.all([getPort(), getPort()]);
	const [server1, server2] = [createServer().listen(port1), createServer().listen(port2)];
	const ports = await portToPid([port1, port2]);

	t.true(ports instanceof Map);

	for (const port of ports.values()) {
		t.is(typeof port, 'number');
	}

	server1.close();
	server2.close();
});

test('pidToPorts()', async t => {
	const firstPort = await getPort();
	const firstServer = createServer().listen(firstPort);

	const secondPort = await getPort();
	const secondServer = createServer().listen(secondPort);

	const portsToCheck = [firstPort, secondPort];

	const pidPorts = await pidToPorts(process.pid);

	for (const port of portsToCheck) {
		t.true(pidPorts.has(port));
	}

	const pidsPorts = (await pidToPorts([process.pid])).get(process.pid);

	for (const port of portsToCheck) {
		t.true(pidsPorts.has(port));
	}

	firstServer.close();
	secondServer.close();
});

test('allPortsWithPid()', async t => {
	const all = await allPortsWithPid();
	t.true(all instanceof Map);
	await t.notThrowsAsync(portToPid([...all.keys()]));
});
