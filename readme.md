# pid-port

> Get the ID of the process that uses a certain port

## Install

```
$ npm install pid-port
```

## Usage

```js
const pidPort = require('pid-port');

(async () => {
	try {
		console.log(await pidPort.portToPid(8080));
		//=> 1337

		const pids = await pidPort.portToPid([8080, 22]);

		console.log(pids.get(8080));
		//=> 1337

		console.log(pids.get(22));
		//=> 12345
	} catch (error) {
		console.log(error);
		//=> 'Could not find a process that uses port `8080`'
	}
})();
```

## API

### pidPort.portToPid(port)

Returns a `Promise<number>` *(integer)* with the process ID.

#### port

Type: `number` *(integer)*

Port to look up.

### pidPort.portToPid(ports)

Returns a `Promise<Map<number, number>>` *(integer)* with the port as key and the process ID as value.

#### ports

Type: `number[]` *(integer)*

Ports to look up.

### pidPort.pidToPorts(pid)

Returns a `Promise<Set<number>>` with the ports.

#### pid

Type: `number`

Process ID to look up.

### pidPort.pidToPorts(pids)

Returns a `Promise<Map<number, Set<number>>>` with the process ID as the key and the ports as value.

#### pids

Type: `number[]`

Process IDs to look up.

### pidPort.all()

Get all process IDs from ports.

Returns a `Promise<Map<number, number>>` *(integer)* with the port as key and the process ID as value.

## Related

- [fkill-cli](https://github.com/sindresorhus/fkill-cli) - Uses this package to let you kill the process that occupies a certain port
