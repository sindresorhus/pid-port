import process from 'node:process';
import execa from 'execa';

const netstat = async type => {
	const {stdout} = await execa('netstat', ['-anv', '-p', type]);
	return stdout;
};

const macos = async () => {
	const result = await Promise.all([
		netstat('tcp'),
		netstat('udp'),
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

	const {groups} = /(?:^|",|",pid=)(?<pid>\d+)/.exec(pid) || {};
	if (groups) {
		return Number.parseInt(groups.pid, 10);
	}
};

const getPort = (port, list) => {
	const regex = new RegExp(`[.:]${port}$`);
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

export async function portToPid(port) {
	if (Array.isArray(port)) {
		const list = await getList();
		const tuples = await Promise.all(port.map(port_ => [port_, getPort(port_, list)]));
		return new Map(tuples);
	}

	if (!Number.isInteger(port)) {
		throw new TypeError(`Expected an integer, got ${typeof port}`);
	}

	return getPort(port, await getList());
}

export async function pidToPorts(pid) {
	if (Array.isArray(pid)) {
		const returnValue = new Map(pid.map(pid_ => [pid_, new Set()]));

		for (const [port, pid_] of await allPortsWithPid()) {
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

	for (const [port, pid_] of await allPortsWithPid()) {
		if (pid_ === pid) {
			returnValue.add(port);
		}
	}

	return returnValue;
}

export async function allPortsWithPid() {
	const list = await getList();
	const returnValue = new Map();

	for (const line of list) {
		const {groups} = /[^]*[.:](?<port>\d+)$/.exec(line[addressColumn]) || {};
		if (groups) {
			returnValue.set(Number.parseInt(groups.port, 10), parsePid(line[portColumn]));
		}
	}

	return returnValue;
}
