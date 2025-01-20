import process from 'node:process';
import {execa} from 'execa';

const netstat = async type => {
	const {stdout} = await execa('netstat', ['-anv', '-p', type]);
	return stdout;
};

const macos = async () => {
	const result = await Promise.all([
		netstat('tcp'),
		netstat('udp'),
	]);

	const tcp = result[0];
	// Column headers are on the second line
	const headerStart = tcp.indexOf('\n') + 1;
	const header = tcp.slice(headerStart, tcp.indexOf('\n', headerStart));

	return {
		stdout: result.join('\n'),
		addressColumn: 3,
		// Some versions of macOS print two extra columns for rxbytes and
		// txbytes before pid. Unfortunately headers can't be parsed because
		// they're space separated but some contain spaces, so we use this
		// heuristic to distinguish the two netstat versions.
		pidColumn: header.includes('rxbytes') ? 10 : 8,
	};
};

const linux = async () => {
	const {stdout} = await execa('ss', ['-tunlp']);
	return {
		stdout,
		addressColumn: 4,
		pidColumn: 6,
	};
};

const windows = async () => {
	const {stdout} = await execa('netstat', ['-ano']);
	return {
		stdout,
		addressColumn: 1,
		pidColumn: 4,
	};
};

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

const getPort = (port, {lines, addressColumn, pidColumn}) => {
	const regex = new RegExp(`[.:]${port}$`);
	const foundPort = lines.find(line => regex.test(line[addressColumn]));

	if (!foundPort) {
		throw new Error(`Could not find a process that uses port \`${port}\``);
	}

	return parsePid(foundPort[pidColumn]);
};

const implementation = process.platform === 'darwin' ? macos : (process.platform === 'linux' ? linux : windows);
const getList = async () => {
	const {stdout, addressColumn, pidColumn} = await implementation();

	const lines = stdout
		.split('\n')
		.filter(line => isProtocol(line))
		.map(line => line.match(/\S+/g) || []);
	return {lines, addressColumn, pidColumn};
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
	const {lines, addressColumn, pidColumn} = await getList();
	const returnValue = new Map();

	for (const line of lines) {
		const {groups} = /[^]*[.:](?<port>\d+)$/.exec(line[addressColumn]) || {};
		if (groups) {
			returnValue.set(Number.parseInt(groups.port, 10), parsePid(line[pidColumn]));
		}
	}

	return returnValue;
}
