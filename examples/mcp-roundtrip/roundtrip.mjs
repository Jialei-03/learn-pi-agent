import assert from 'node:assert/strict';
import { McpAbortError, McpClient } from '@earendil-works/pi-mcp';
import { createInMemoryTransportPair } from '@earendil-works/pi-mcp/testing';

// Only the book server is scripted. Pairing, cancellation, and late-response handling
// run inside the real MCP client. Coordination uses delivered messages, not sleeps.
const { client: transport, server } = createInMemoryTransportPair();
const client = new McpClient({ name: 'reader', version: '1', requestTimeoutMs: 2000 });
const twoLookups = Promise.withResolvers();
const thirdLookup = Promise.withResolvers();
const cancelled = Promise.withResolvers();
const lateResponse = Promise.withResolvers();
const requests = [];
client.onError(error => lateResponse.resolve(error.message));
server.onMessage(message => {
  if (message.method === 'initialize') {
    void server.send({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
      serverInfo: { name: 'library', version: '1' },
    } });
  } else if (message.method === 'tools/call') {
    requests.push(message);
    if (requests.length === 2) twoLookups.resolve();
    if (requests.length === 3) thirdLookup.resolve();
  } else if (message.method === 'notifications/cancelled') {
    cancelled.resolve(message.params.requestId);
  }
});

function reply(request, title) {
  return server.send({ jsonrpc: '2.0', id: request.id,
    result: { content: [{ type: 'text', text: title }] } });
}

await server.start();
try {
  await client.connect(transport);
  const first = client.callTool('lookup', { isbn: 'A-17' });
  const second = client.callTool('lookup', { isbn: 'B-22' });
  await twoLookups.promise;
  const [a, b] = requests;
  console.log(`请求顺序  ${a.id} A-17 → ${b.id} B-22`);
  await reply(b, '并发控制');
  const secondTitle = (await second).content[0].text;
  await reply(a, '树的遍历');
  const firstTitle = (await first).content[0].text;
  assert.equal(firstTitle, '树的遍历');
  assert.equal(secondTitle, '并发控制');
  console.log(`应答顺序  ${b.id} ${secondTitle} → ${a.id} ${firstTitle}`);
  console.log(`调用者 A 收到 ${firstTitle}，调用者 B 收到 ${secondTitle}`);

  const controller = new AbortController();
  const third = client.callTool('lookup', { isbn: 'C-35' }, { signal: controller.signal });
  const rejected = assert.rejects(third, McpAbortError);
  await thirdLookup.promise;
  controller.abort('user changed task');
  await rejected;
  const cancelledId = await cancelled.promise;
  assert.equal(cancelledId, requests[2].id);
  await reply(requests[2], '迟到的结果');
  const diagnostic = await lateResponse.promise;
  assert.match(diagnostic, /unknown MCP request/);
  console.log(`取消请求  ${cancelledId}，本地 Promise 以 McpAbortError 结束`);
  console.log(`晚到应答  ${diagnostic}`);
} finally {
  await client.close();
}
