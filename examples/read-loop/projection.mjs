import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { buildSessionContext, estimateTokens, findCutPoint } from '@earendil-works/pi-coding-agent';

const user = content => ({ role: 'user', content, timestamp: 0 });
const messages = [
  user('old history'),
  fauxAssistantMessage('old answer', { timestamp: 0 }),
  user('read the large file'),
  fauxAssistantMessage(fauxToolCall('read', { path: 'big.txt' }, { id: 'call-1' }), { stopReason: 'toolUse', timestamp: 0 }),
  { role: 'toolResult', toolCallId: 'call-1', toolName: 'read', isError: false,
    content: [{ type: 'text', text: 'x'.repeat(8000) }], timestamp: 0 },
];
const ids = ['a', 'b', 'c', 'd', 'e'];
const timestamp = new Date(0).toISOString();
const entries = messages.map((message, i) => ({
  type: 'message', id: ids[i], parentId: ids[i-1] ?? null, timestamp, message,
}));

const keepRecentTokens = 1000;
const cut = findCutPoint(entries, 0, entries.length, keepRecentTokens);
const checkpoint = {
  type: 'compaction', id: 'x', parentId: 'e', timestamp,
  // The exact summary text is supplied for teaching. No remote summarizer is called.
  summary: '此前已完成旧问题。本轮用户要求读取 big.txt。',
  firstKeptEntryId: ids[cut.firstKeptEntryIndex], tokensBefore: messages.reduce((n, m) => n + estimateTokens(m), 0),
};
function roles(records, leaf) {
  return buildSessionContext(records, leaf).messages.map(message => message.role);
}

console.log(JSON.stringify({
  records: entries.map(entry => ({ id: entry.id, role: entry.message.role, estimate: estimateTokens(entry.message) })),
  keepRecentTokens, cut, checkpoint,
  before: roles(entries, 'e'),
  after: roles([...entries, checkpoint], 'x'),
  oldLeaf: roles([...entries, checkpoint], 'e'),
}, null, 2));
