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
	console.log(await portToPid(8080));
	//=> 1337

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

## API

### portToPid(port)

Returns a `Promise<number>` *(integer)* with the process ID.

#### port

Type: `number` *(integer)*

The port to look up.

### portToPid(ports)

Returns a `Promise<Map<number, number>>` *(integer)* with the port as key and the process ID as value.

#### ports

Type: `number[]` *(integer)*

The ports to look up.

### pidToPorts(pid)

Returns a `Promise<Set<number>>` with the ports.

#### pid

Type: `number`

The process ID to look up.

### pidToPorts(pids)

Returns a `Promise<Map<number, Set<number>>>` with the process ID as the key and the ports as value.

#### pids

Type: `number[]`

The process IDs to look up.

### allPortsWithPid()

Get all ports with their process ID.

Returns a `Promise<Map<number, number>>` *(integer)* with the port as key and the process ID as value.

## Related

- [fkill-cli](https://github.com/sindresorhus/fkill-cli) - Uses this package to let you kill the process that occupies a certain port
- [pid-cwd](https://github.com/neeksandhu/pid-cwd) - Find the working directory of a process from its process ID
