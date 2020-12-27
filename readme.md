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

Returns a `Promise<number>` with the process ID.

#### port

Type: `number`

Port to look up.

### pidPort.portToPid(ports)

Returns a `Promise<Map<number, number>>` with the port as key and the process ID as value.

#### ports

Type: `number[]`

Ports to look up.

### pidPort.all()

Get all process IDs from ports.

Returns a `Promise<Map<number, number>>` with the port as key and the process ID as value.
