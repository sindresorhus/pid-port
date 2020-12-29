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

module.exports.portToPid = async (arg1, arg2) => {
	let host;
	let port;
	if (typeof arg1 === 'object' && arg1.port) {
		port = arg1.port;
		host = arg1.host;
	} else if (typeof arg2 === 'string') {
		port = arg1;
		host = arg2;
	} else if (Array.isArray(arg1)) {
		port = arg1;
		const list = await getList();
		const tuples = await Promise.all(port.map(port_ => [port_, getPort(port_, list)]));
		return new Map(tuples);
	} else {
		port = arg1;
	}

	if (host && typeof host !== 'string') {
		throw new TypeError(`Expected host to be a string, got ${typeof host}`);
	}

	if (typeof port !== 'number') {
		throw new TypeError(`Expected port to be a number, got ${typeof port}`);
	}

	return getPort(port, await getList(), host);
};

module.exports.all = async () => {
	const list = await getList();
	const returnValue = new Map();

	for (const line of list) {
		const {groups} = /[^]*[.:](?<port>\d+)$/.exec(line[addressColumn]);
		if (groups) {
			returnValue.set(Number.parseInt(groups.port, 10), parsePid(line[portColumn]));
		}
	}

	return returnValue;
};
