import test from 'node:test';
import assert from 'node:assert/strict';
import { serveStatic } from '../src/server.mjs';

test('missing static assets return one 404 response without throwing or double-writing headers', async () => {
  const writes = [];
  const response = {
    headersSent: false,
    writeHead(status) { this.headersSent = true; writes.push(status); },
    end() {}
  };
  await serveStatic({ url: '/favicon.ico' }, response);
  assert.deepEqual(writes, [404]);
});
