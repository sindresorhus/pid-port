import process from 'node:process';
import {execa} from 'execa';

const netstat = async type => {
	const {stdout} = await execa('netstat', ['-anv', '-p', type]);
	return stdout;
};

const macos = async () => {
	const [tcp, udp] = await Promise.all([
		netstat('tcp'),
		netstat('udp'),
	]);

	// Column headers are on the second line
	const headerStart = tcp.indexOf('\n') + 1;
	const header = tcp.slice(headerStart, tcp.indexOf('\n', headerStart));

	return {
		stdout: [tcp, udp].join('\n'),
		addressColumn: 3,
		// Some versions of macOS print two extra columns for rxbytes and
		// txbytes before pid. Unfortunately headers can't be parsed because
		// they're space separated but some contain spaces, so we use this
		// heuristic to distinguish the two netstat versions.
		pidColumn: header.includes('rxbytes') ? 10 : 8,
	};
};

const lsofFallback = async port => {
	// Only used when columns do not contain PID info due to privileges
	// -nP: no DNS, numeric ports; -i: filter; -sTCP:LISTEN to prefer listeners
	const args = ['-nP'];
	if (port) {
		args.push('-i', `:${port}`);
	}

	const {stdout} = await execa('lsof', args);
	return stdout;
};

const linux = async () => {
	const {stdout} = await execa('ss', ['-tunlp']);
	return {stdout, addressColumn: 4, pidColumn: 6};
};

const windows = async () => {
	const {stdout} = await execa('netstat', ['-ano']);
	return {stdout, addressColumn: 1, pidColumn: 4};
};

const isProtocol = value => /^\s*(tcp|udp)/i.test(value);

const stripIpv6Brackets = host =>
	host?.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

const normalizeHost = host => {
	const normalizedHost = stripIpv6Brackets(host);
	if (normalizedHost === 'localhost') {
		return '127.0.0.1';
	}

	if (normalizedHost === '::ffff:127.0.0.1') {
		return '127.0.0.1';
	}

	if (normalizedHost === '::') {
		return '*';
	}

	return normalizedHost;
};

const parsePid = pid => {
	if (typeof pid !== 'string') {
		return;
	}

	// Linux ss: users:(("node",pid=1337,fd=123))
	const linuxMatch = /pid=(?<pid>\d+)/.exec(pid);
	if (linuxMatch?.groups?.pid) {
		return Number.parseInt(linuxMatch.groups.pid, 10);
	}

	// MacOS netstat - handles both old format (macOS 15 and older) and new format (macOS 26+)
	// Old format: "1337" or ",1337" or ",pid=1337"
	// New format: "prog:1337" (macOS 26+)
	const macMatch = /(?:^|",|",pid=|[A-Za-z]+:)(?<pid>\d+)/.exec(pid);
	if (macMatch?.groups?.pid) {
		return Number.parseInt(macMatch.groups.pid, 10);
	}

	// Windows netstat -ano: 1337
	if (/^\d+$/.test(pid)) {
		return Number.parseInt(pid, 10);
	}
};

const parseAddress = address => {
	// Match "...:123" or "... .123" with the port at the end; keep host greedy to the last separator
	const match = /^(?<host>.+?)[.:](?<port>\d+)$/.exec(address);
	const rawHost = match?.groups?.host ?? address;
	const host = normalizeHost(rawHost);
	const port = match?.groups?.port ? Number.parseInt(match.groups.port, 10) : undefined;
	return {host, port};
};

const isLocalhostAddress = host => host === '127.0.0.1' || host === '::1';

const createHostFilter = host => {
	const normalizedHost = host === undefined ? undefined : normalizeHost(host);
	if (normalizedHost === '*' || normalizedHost === '0.0.0.0' || normalizedHost === '::') {
		return {type: 'all'};
	}

	if (normalizedHost === undefined) {
		return {type: 'localhost'};
	}

	return {type: 'specific', host: normalizedHost};
};

const applyHostFilter = (lines, addressColumn, hostFilter) => {
	if (hostFilter.type === 'all') {
		return lines;
	}

	if (hostFilter.type === 'localhost') {
		return lines.filter(line => {
			const {host} = parseAddress(line[addressColumn]);
			return isLocalhostAddress(host);
		});
	}

	// Specific host
	return lines.filter(line => {
		const {host} = parseAddress(line[addressColumn]);
		return host === hostFilter.host;
	});
};

const sortByHostPriority = (items, getAddress) => items.sort((a, b) => {
	const addressA = getAddress(a);
	const addressB = getAddress(b);

	// Prefer IPv4 localhost over IPv6 localhost
	if (addressA.startsWith('127.0.0.1') && addressB.startsWith('::1')) {
		return -1;
	}

	if (addressA.startsWith('::1') && addressB.startsWith('127.0.0.1')) {
		return 1;
	}

	// For other addresses, sort alphabetically
	return addressA.localeCompare(addressB);
});

const createPortErrorMessage = (port, hostFilter) => {
	if (hostFilter.type === 'localhost') {
		return `Could not find a process that uses port \`${port}\` on localhost`;
	}

	if (hostFilter.type === 'specific') {
		return `Could not find a process that uses port \`${port}\` on host \`${hostFilter.host}\``;
	}

	return `Could not find a process that uses port \`${port}\``;
};

const validatePort = (port, context = 'a TCP/UDP port') => {
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new TypeError(`Expected ${context} between 1 and 65535, got ${port}`);
	}
};

const validateHost = host => {
	if (host !== undefined && typeof host !== 'string') {
		throw new TypeError(`Expected host to be a string, got ${typeof host}`);
	}
};

const validatePid = pid => {
	if (!Number.isInteger(pid)) {
		throw new TypeError(`Expected an integer, got ${typeof pid}`);
	}
};

const filterPortLines = (port, {lines, addressColumn}, hostFilter) => {
	const regex = new RegExp(`[.:]${port}$`);
	const matchingPorts = lines.filter(line => regex.test(line[addressColumn]));
	return applyHostFilter(matchingPorts, addressColumn, hostFilter);
};

const getPort = async (port, {lines, addressColumn, pidColumn}, host) => {
	validatePort(port);
	const hostFilter = createHostFilter(host);
	const matchingPorts = filterPortLines(port, {lines, addressColumn}, hostFilter);

	if (matchingPorts.length === 0) {
		throw new Error(createPortErrorMessage(port, hostFilter));
	}

	// Sort with localhost priority
	sortByHostPriority(matchingPorts, line => line[addressColumn]);

	const pid = parsePid(matchingPorts[0][pidColumn]);
	if (pid !== undefined) {
		return pid;
	}

	// Fallback when PID info is hidden/privileged (Linux/macOS)
	if (process.platform === 'darwin' || process.platform === 'linux') {
		try {
			const out = await lsofFallback(port);

			// Match ":PORT" and capture PID column (more precise)
			const match = new RegExp(`[\\[\\]:.]${port}\\s.*?\\s+(\\d+)\\s+`).exec(out);
			if (match?.[1]) {
				return Number.parseInt(match[1], 10);
			}
		} catch {
			// Lsof failed, continue with original error
		}
	}

	return undefined;
};

const platformImplementations = {darwin: macos, linux};
const implementation = platformImplementations[process.platform] ?? windows;

const getList = async () => {
	const {stdout, addressColumn, pidColumn} = await implementation();

	const lines = stdout
		.split('\n')
		.filter(line => isProtocol(line))
		.map(line => line.match(/\S+/g) || []);
	return {lines, addressColumn, pidColumn};
};

export async function portToPid(portOrOptions) {
	// Handle options object: {port: 8080, host: '127.0.0.1'}
	if (typeof portOrOptions === 'object' && !Array.isArray(portOrOptions) && 'port' in portOrOptions) {
		const {port, host} = portOrOptions;
		validatePort(port, 'port to be an integer');
		validateHost(host);
		return getPort(port, await getList(), host);
	}

	// Handle array of ports: [8080, 8081]
	if (Array.isArray(portOrOptions)) {
		const ports = portOrOptions;
		for (const value of ports) {
			validatePort(value, 'port to be an integer');
		}

		const list = await getList();
		const results = await Promise.all(ports.map(async port => [port, await getPort(port, list)]));
		return new Map(results);
	}

	// Handle single port: 8080
	const port = portOrOptions;
	validatePort(port);
	return getPort(port, await getList());
}

const getPidsToPortsMap = async pids => {
	const resultMap = new Map(pids.map(pid => [pid, new Set()]));

	// Get all ports from all interfaces for pidToPorts - user wants to know ALL ports this PID uses
	for (const [port, pid] of await allPortsWithPid({host: '*'})) {
		resultMap.get(pid)?.add(port);
	}

	return resultMap;
};

export async function pidToPorts(pid) {
	if (Array.isArray(pid)) {
		return getPidsToPortsMap(pid);
	}

	validatePid(pid);
	const resultMap = await getPidsToPortsMap([pid]);
	return resultMap.get(pid);
}

export async function allPortsWithPid(options) {
	validateHost(options?.host);
	const {lines, addressColumn, pidColumn} = await getList();
	const hostFilter = createHostFilter(options?.host);

	const resultMap = new Map();

	// Apply host filtering to all lines, then extract ports
	const filteredLines = applyHostFilter(lines, addressColumn, hostFilter);

	for (const line of filteredLines) {
		const {port} = parseAddress(line[addressColumn]);
		const pid = parsePid(line[pidColumn]);

		if (port !== undefined && pid !== undefined) {
			resultMap.set(port, pid);
		}
	}

	return resultMap;
}

export async function portBindings(port, options) {
	validatePort(port);
	validateHost(options?.host);

	const {lines, addressColumn, pidColumn} = await getList();
	const hostFilter = createHostFilter(options?.host);
	const matchingPorts = filterPortLines(port, {lines, addressColumn}, hostFilter);

	if (matchingPorts.length === 0) {
		const baseMessage = createPortErrorMessage(port, hostFilter);
		throw new Error(baseMessage.replace('a process that uses', 'any processes using'));
	}

	const seen = new Set();
	const bindings = [];
	for (const line of matchingPorts) {
		const {host} = parseAddress(line[addressColumn]);
		const pid = parsePid(line[pidColumn]);

		if (pid === undefined) {
			continue;
		}

		// Deduplicate bindings across TCP/UDP or duplicate rows
		const key = `${host}|${pid}`;
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		bindings.push({host, pid});
	}

	// Sort with localhost priority
	return sortByHostPriority(bindings, binding => binding.host);
}
