const http = require('http');

const server = http.createServer().listen(process.argv[2], process.argv[3]);
process.send({});
process.on('SIGTERM', () => {
	server.close();
});
