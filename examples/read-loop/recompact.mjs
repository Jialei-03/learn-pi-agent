import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';

// Supply fixed summary texts and exercise the real entry/projection path, without
// paying for a summarization call. The manager creates actual IDs during append.
const session = SessionManager.inMemory();
const add = text => session.appendMessage({ role: 'user', content: text, timestamp: 0 });
function show(label, expected) {
  const messages = session.buildSessionProjection().messages;
  const texts = messages.map(message => message.role === 'compactionSummary' ? message.summary : message.content);
  assert.deepEqual(texts, expected);
  console.log(label + '  ' + texts.join(' → '));
}
const a = add('旧材料');
const b = add('保留项');
session.appendCompaction('摘要一', b, 80);
show('第一次压缩', ['摘要一', '保留项']);
session.appendContextEdit(b, { content: '保留项（修订）' });
show('追加编辑后', ['摘要一', '保留项（修订）']);
add('后来补充');
session.appendCompaction('摘要二', b, 60);
show('第二次压缩', ['摘要二', '保留项（修订）', '后来补充']);
const handoff = session.appendCompaction('交接摘要', null, 40);
assert.equal(session.getEntry(handoff).firstKeptEntryId, handoff);
show('保留零条', ['交接摘要']);
session.branch(a);
show('切回旧叶子', ['旧材料']);
