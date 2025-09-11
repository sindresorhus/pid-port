# pid-port

> Get the ID of the process that uses a certain port

## Install

```sh
npm install pid-port
```

## Usage

```js
import {portToPid} from 'pid-port';

try {
	// Only checks localhost by default
	console.log(await portToPid(8080));
	//=> 1337

	// Same as above
	console.log(await portToPid({port: 8080}));
	//=> 1337

	const pids = await portToPid([8080, 22]);

	console.log(pids.get(8080));
	//=> 1337

	console.log(pids.get(22));
	//=> 12345

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

## API

### portToPid(portOrOptions)

Get the process ID for a port.

Returns a `Promise<number | undefined>` *(integer)* with the process ID.

> [!NOTE]
> By default, only checks localhost (`127.0.0.1` and `::1`). Use `{host: '*'}` to check all interfaces if needed.

**Linux privilege requirements**: On Linux systems, process ID information may not be visible to non-privileged users. If a port is found but no PID is returned, the package will attempt to use `lsof` as a fallback (requires `lsof` to be installed).

#### portOrOptions

Type: `number | {port: number, host?: string}`

Either a port number directly, or an options object with:
- `port` *(number)*: The port to look up
- `host` *(string, optional)*: The host to filter by. Use `'*'`, `'0.0.0.0'`, or `'::'` for all interfaces. Use `'localhost'` for explicit localhost filtering.

### portToPid(ports)

Get the process IDs for multiple ports.

Returns a `Promise<Map<number, number>>` *(integer)* with the port as key and the process ID as value.

@example
```js
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

#### ports

Type: `number[]` *(integer)*

The ports to look up.

### pidToPorts(pid)

Get the ports for a process ID.

Returns a `Promise<Set<number>>` with the ports.

@example
```js
import {pidToPorts} from 'pid-port';

try {
	const ports = await pidToPorts(1337);
	//=> Set { 8080, 22 }
} catch (error) {
	console.log(error);
}
```

#### pid

Type: `number`

The process ID to look up.

### pidToPorts(pids)

Get the ports for multiple process IDs.

Returns a `Promise<Map<number, Set<number>>>` with the process ID as the key and the ports as value.

@example
```js
import {pidToPorts} from 'pid-port';

try {
	const ports = await pidToPorts([1337, 12345]);
	//=> Map { 1337 => Set { 8080, 22 }, 12345 => Set { 3000 } }
} catch (error) {
	console.log(error);
}
```

#### pids

Type: `number[]`

The process IDs to look up.

### allPortsWithPid(options?)

Get all ports with their process ID, optionally filtered by host.

Returns a `Promise<Map<number, number>>` *(integer)* with the port as key and the process ID as value.

> [!NOTE]
> By default, only checks localhost (`127.0.0.1` and `::1`). Use `{host: '*'}` to check all interfaces if needed.

@example
```js
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

#### options

Type: `object` *(optional)*

##### host

Type: `string` *(optional)*

The host to filter by. Use `'*'`, `'0.0.0.0'`, or `'::'` for all interfaces.

### portBindings(port, options?)

Get all process bindings for a specific port.

Returns a `Promise<Array<{host: string; pid: number}>>` with detailed binding information.

> [!NOTE]
> By default, only checks localhost (`127.0.0.1` and `::1`). Use `{host: '*'}` to check all interfaces if needed.

@example
```js
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

#### port

Type: `number` *(integer)*

The port to look up.

#### options

Type: `object` *(optional)*

##### host

Type: `string` *(optional)*

The host to filter by. Use `'*'`, `'0.0.0.0'`, or `'::'` for all interfaces.

## Related

- [fkill-cli](https://github.com/sindresorhus/fkill-cli) - Uses this package to let you kill the process that occupies a certain port
- [pid-cwd](https://github.com/neeksandhu/pid-cwd) - Find the working directory of a process from its process ID
