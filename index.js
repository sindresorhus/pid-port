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
const columns = process.platform === 'darwin' ? [3, 8] : (process.platform === 'linux' ? [4, 6] : [1, 4]);
const isProtocol = x => /^\s*(tcp|udp)/i.test(x);

const parsePid = pid => {
	if (typeof pid !== 'string') {
		return;
	}

	const match = /(?:^|",|",pid=)(\d+)/.exec(pid);
	if (!match) {
		return;
	}

	return Number.parseInt(match[1], 10);
};

const getPort = (port, list) => {
	const regex = new RegExp(`[.:]${port}$`);
	const foundPort = list.find(x => regex.test(x[columns[0]]));

	if (!foundPort) {
		throw new Error(`Could not find a process that uses port \`${port}\``);
	}

	return parsePid(foundPort[columns[1]]);
};

const getList = async () => {
	const list = await getListFunction();

	return list.split('\n')
		// TODO: Remove the `.reduce`.
		// eslint-disable-next-line unicorn/no-reduce
		.reduce((result, x) => {
			if (isProtocol(x)) {
				result.push(x.match(/\S+/g) || []);
			}

			return result;
		}, []);
};

module.exports.portToPid = async port => {
	if (Array.isArray(port)) {
		const list = await getList();
		const tuples = await Promise.all(port.map(x => [x, getPort(x, list)]));
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

	for (const x of list) {
		const match = /[^]*[.:](\d+)$/.exec(x[columns[0]]);
		if (match) {
			returnValue.set(Number.parseInt(match[1], 10), parsePid(x[columns[1]]));
		}
	}

	return returnValue;
};
