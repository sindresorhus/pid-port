'use strict';
const execa = require('execa');

const netstat = async type => {
	const {stdout} = await execa('netstat', ['-anv', '-p', type]);
	return stdout;
};

const macos = async () => {
	const result = await Promise.all([
		netstat('tcp'),
		netstat('udp')
	]);

	return result.join('\n');
};

const linux = async () => {
	const {stdout} = await execa('ss', ['-tunlp']);
	return stdout;
};

const win32 = async () => {
	const {stdout} = await execa('netstat', ['-ano']);
	return stdout;
};

const getListFunction = process.platform === 'darwin' ? macos : (process.platform === 'linux' ? linux : win32);
const addressColumn = process.platform === 'darwin' ? 3 : (process.platform === 'linux' ? 4 : 1);
const portColumn = process.platform === 'darwin' ? 8 : (process.platform === 'linux' ? 6 : 4);
const isProtocol = value => /^\s*(tcp|udp)/i.test(value);

const parsePid = pid => {
	if (typeof pid !== 'string') {
		return;
	}

	const {groups} = /(?:^|",|",pid=)(?<pid>\d+)/.exec(pid);
	if (groups) {
		return Number.parseInt(groups.pid, 10);
	}
};

const getPort = (port, list, host) => {
	const regex = host ? new RegExp(`${host}:${port}$`) : new RegExp(`[.:]${port}$`);

	const foundPort = list.find(line => regex.test(line[addressColumn]));

	if (!foundPort) {
		throw new Error(`Could not find a process that uses port \`${port}\``);
	}

	return parsePid(foundPort[portColumn]);
};

const getList = async () => {
	const list = await getListFunction();

	return list
		.split('\n')
		.filter(line => isProtocol(line))
		.map(line => line.match(/\S+/g) || []);
};

module.exports.portToPid = async options => {
	let host;
	let port;
	if (typeof options === 'object' && options.port) {
		port = options.port;
		host = options.host;
	} else if (Array.isArray(options)) {
		const ports = options;
		const list = await getList();
		const tuples = await Promise.all(ports.map(port_ => [port_, getPort(port_, list)]));
		return new Map(tuples);
	} else {
		port = options;
	}

	if (host && typeof host !== 'string') {
		throw new TypeError(`Expected host to be a string, got ${typeof host}`);
	}

	if (!Number.isInteger(port)) {
		throw new TypeError(`Expected an integer, got ${typeof port}`);
	}

	return getPort(port, await getList(), host);
};

module.exports.pidToPorts = async pid => {
	if (Array.isArray(pid)) {
		const returnValue = new Map(pid.map(pid_ => [pid_, new Set()]));

		for (const [port, pid_] of await module.exports.all()) {
			if (returnValue.has(pid_)) {
				returnValue.get(pid_).add(port);
			}
		}

		return returnValue;
	}

	if (!Number.isInteger(pid)) {
		throw new TypeError(`Expected an integer, got ${typeof pid}`);
	}

	const returnValue = new Set();

	for (const [port, pid_] of await module.exports.all()) {
		if (pid_ === pid) {
			returnValue.add(port);
		}
	}

	return returnValue;
};

module.exports.all = async host => {
	const list = await getList();
	const returnValue = new Map();

	for (const line of list) {
		const {groups} = /^(?<host>.*)[.:](?<port>\d+)$/.exec(line[addressColumn]);
		if (groups) {
			if (!host || groups.host === host) {
				returnValue.set(Number.parseInt(groups.port, 10), parsePid(line[portColumn]));
			}
		}
	}

	return returnValue;
};
