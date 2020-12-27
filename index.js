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

const getPort = (port, list) => {
	const regex = new RegExp(`[.:]${port}$`);
	const foundPort = list.find(value => regex.test(value[addressColumn]));

	if (!foundPort) {
		throw new Error(`Could not find a process that uses port \`${port}\``);
	}

	return parsePid(foundPort[portColumn]);
};

const getList = async () => {
	const list = await getListFunction();

	return list.split('\n').filter(item => isProtocol(item)).map(item => /\S+/g.exec(item) || []);
};

module.exports.portToPid = async port => {
	if (Array.isArray(port)) {
		const list = await getList();
		const tuples = await Promise.all(port.map(value => [value, getPort(value, list)]));
		return new Map(tuples);
	}

	if (typeof port !== 'number') {
		throw new TypeError(`Expected a number, got ${typeof port}`);
	}

	return getPort(port, await getList());
};

module.exports.all = async () => {
	const list = await getList();
	const returnValue = new Map();

	for (const item of list) {
		const {groups} = /[^]*[.:](?<port>\d+)$/.exec(item[addressColumn]);
		if (groups) {
			returnValue.set(Number.parseInt(groups.port, 10), parsePid(item[portColumn]));
		}
	}

	return returnValue;
};
