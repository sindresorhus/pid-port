export type HostOption = string | undefined;

/**
Get the process ID for a port.

@param portOrOptions - The port number or an options object with port and optional host.
@returns The process ID.

Note: By default, only checks localhost (`127.0.0.1` and `::1`). Use `{host: '*'}` to check all interfaces if needed.

@example
```
import {portToPid} from 'pid-port';

try {
	// Only checks localhost
	console.log(await portToPid(8080));
	//=> 1337

	// Same as above
	console.log(await portToPid({port: 8080}));
	//=> 1337

	// Specific host
	console.log(await portToPid({port: 8080, host: '127.0.0.1'}));
	//=> 1337

	// Check all interfaces (use with caution)
	console.log(await portToPid({port: 8080, host: '*'}));
	//=> 1337
} catch (error) {
	console.log(error);
	//=> 'Could not find a process that uses port `8080` on localhost'
}
```
*/
export function portToPid(portOrOptions: number | {port: number; host?: HostOption}): Promise<number | undefined>;

/**
Get the process IDs for multiple ports.

@param ports - The ports to look up.
@returns A map with the port as key and the process ID as value.

@example
```
import {portToPid} from 'pid-port';

try {
	const pids = await portToPid([8080, 22]);

	console.log(pids.get(8080));
	//=> 1337

	console.log(pids.get(22));
	//=> 12345
} catch (error) {
	console.log(error);
	//=> 'Could not find a process that uses port `8080`'
}
```
*/
export function portToPid(ports: number[]): Promise<Map<number, number>>;

/**
Get the ports for a process ID.

@param pid - The process ID to look up.
@returns A set with the ports.

@example
```
import {pidToPorts} from 'pid-port';

try {
	const ports = await pidToPorts(1337);
	//=> Set { 8080, 22 }
} catch (error) {
	console.log(error);
}
```
*/
export function pidToPorts(pid: number): Promise<Set<number>>;

/**
Get the ports for multiple process IDs.

@param pids - The process IDs to look up.
@returns A map with the process ID as the key and the ports as value.

@example
```
import {pidToPorts} from 'pid-port';

try {
	const ports = await pidToPorts([1337, 12345]);
	//=> Map { 1337 => Set { 8080, 22 }, 12345 => Set { 3000 } }
} catch (error) {
	console.log(error);
}
```
*/
export function pidToPorts(pids: number[]): Promise<Map<number, Set<number>>>;

/**
Get all ports with their process ID, optionally filtered by host.

@param options - Options object with optional host filter.
@param options.host - The host to filter by. Use '*', '0.0.0.0', or '::' for all interfaces.
@returns A map with the port as key and the process ID as value.

Note: By default, only checks localhost (`127.0.0.1` and `::1`). Use `{host: '*'}` to check all interfaces if needed.

@example
```
import {allPortsWithPid} from 'pid-port';

try {
	// Only localhost ports
	const localhost = await allPortsWithPid();
	//=> Map { 8080 => 1337, 22 => 12345 }

	// Specific host
	const filtered = await allPortsWithPid({host: '127.0.0.1'});
	//=> Map { 8080 => 1337, 22 => 12345 }

	// All interfaces (use with caution)
	const all = await allPortsWithPid({host: '*'});
	//=> Map { 8080 => 1337, 22 => 12345, 3000 => 14311 }
} catch (error) {
	console.log(error);
}
```
*/
export function allPortsWithPid(options?: {host?: HostOption}): Promise<Map<number, number>>;

/**
Get all process bindings for a specific port.

@param port - The port to look up.
@param options - Options object with optional host filter.
@param options.host - The host to filter by. Use '*', '0.0.0.0', or '::' for all interfaces.
@returns An array of objects with host and process ID information for all bindings.

Note: By default, only checks localhost (`127.0.0.1` and `::1`). Use `{host: '*'}` to check all interfaces if needed.

@example
```
import {portBindings} from 'pid-port';

try {
	// Only localhost bindings
	const bindings = await portBindings(8080);
	//=> [{host: '127.0.0.1', pid: 1337}]

	// All interfaces (use with caution)
	const allBindings = await portBindings(8080, {host: '*'});
	//=> [
	//   {host: '127.0.0.1', pid: 1337},
	//   {host: '192.168.1.1', pid: 5678}
	// ]
} catch (error) {
	console.log(error);
}
```
*/
export function portBindings(port: number, options?: {host?: HostOption}): Promise<Array<{host: string; pid: number}>>;
