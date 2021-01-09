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

Returns a `Promise<integer>` with the process ID.

#### port

Type: `number` *(integer)*

Port to look up.

### pidPort.portToPid(ports)

Returns a `Promise<Map<integer, integer>>` with the port as key and the process ID as value.

#### ports

Type: `integer[]`

Ports to look up.

### pidPort.all()

Get all process IDs from ports.

Returns a `Promise<Map<integer, integer>>` with the port as key and the process ID as value.

## Related

- [fkill-cli](https://github.com/sindresorhus/fkill-cli) - Uses this package to let you kill the process that occupies a certain port
