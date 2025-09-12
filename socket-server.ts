import http from 'http';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';

// Basic HTTP + WebSocket server (placeholder until real logic added)
const port = Number(process.env.PORT) || 10000;

const server = http.createServer((_req, res) => {
	res.writeHead(200, { 'Content-Type': 'text/plain' });
	res.end('OK');
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws: WebSocket) => {
	ws.send(JSON.stringify({ t: 'hello', msg: 'socket-server online' }));
	ws.on('message', (data: RawData) => {
		// Simple echo protocol
		ws.send(JSON.stringify({ t: 'echo', data: data.toString() }));
	});
});

server.listen(port, '0.0.0.0', () => {
	console.log(`Server listening on port ${port}`);
});

