/**
Get the process ID for a port.

@param port - The port to look up.
@returns The process ID.

@example
```
import {portToPid} from 'pid-port';

try {
	console.log(await portToPid(8080));
	//=> 1337
} catch (error) {
	console.log(error);
	//=> 'Could not find a process that uses port `8080`'
}
```
*/
export function portToPid(port: number): Promise<number | undefined>;

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
Get all ports with their process ID.

@returns A map with the port as key and the process ID as value.

@example
```
import {allPortsWithPid} from 'pid-port';

try {
	const all = await allPortsWithPid();
	//=> Map { 8080 => 1337, 22 => 12345, 3000 => 14311 }
} catch (error) {
	console.log(error);
}
```
*/
export function allPortsWithPid(): Promise<Map<number, number>>;
