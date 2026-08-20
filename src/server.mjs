import { createServer } from 'node:http';

const preferredPort = 18473;
const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, service: 'tfttool' }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(preferredPort, '127.0.0.1', () => {
  const address = server.address();
  console.log(`TFTTool service listening on http://127.0.0.1:${address.port}`);
});

server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  server.listen(0, '127.0.0.1');
});
