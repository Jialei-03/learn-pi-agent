// 第 8 章实验：Pi 压缩时从哪里切？
//   node labs/ch08/pi-cut-point.ts
// 构造一段 5 轮的对话（每轮：用户提问 → 模型调用 read → 工具结果 → 模型回答），
// 设定“至少保留最近约 N 个 token”，交给 Pi 真实的 findCutPoint。
import assert from 'node:assert/strict';
import { SessionManager, findCutPoint } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';

function conversation(turns: number, hugeTurn?: number): any[] {
  const pi: any[] = [];
  for (let t = 1; t <= turns; t++) {
    const body = `// file${t}.ts\n` + 'x'.repeat(t === hugeTurn ? 6000 : 800);     // 某一轮读了一个特别大的文件
    pi.push({ role: 'user', content: `问题 ${t}`, timestamp: 0 });
    pi.push(fauxAssistantMessage(fauxToolCall('read', { path: `src/file${t}.ts` }, { id: `c${t}` }), { stopReason: 'toolUse' }));
    pi.push({ role: 'toolResult', toolCallId: `c${t}`, toolName: 'read', content: [{ type: 'text', text: body }], isError: false, timestamp: 0 });
    pi.push(fauxAssistantMessage(`回答 ${t}`));
  }
  return pi;
}
const label = (m: any, i: number) => `#${i} ${m.role === 'user' ? m.content : m.role === 'toolResult' ? '工具结果' : m.content[0].type === 'toolCall' ? '模型调用 read' : m.content[0].text}`;

for (const c of [
  { title: '情形一：额度恰好在一轮的开头用完', keep: 424, huge: undefined, firstKept: 12, split: false },
  { title: '情形二：额度在一轮的中间用完', keep: 450, huge: undefined, firstKept: 11, split: true },
  { title: '情形三：最近一轮特别大，单独就超过了保留额度', keep: 450, huge: 5, firstKept: 19, split: true },
]) {
  const msgs = conversation(5, c.huge);
  const session = SessionManager.inMemory('/repo');
  for (const m of msgs) session.appendMessage(m);
  const entries = session.getEntries();
  const p = findCutPoint(entries, 0, entries.length, c.keep);
  console.log(`${c.title}（保留约 ${c.keep} tokens）`);
  console.log(`  从 ${label(msgs[p.firstKeptEntryIndex], p.firstKeptEntryIndex)} 开始保留，split turn = ${p.isSplitTurn}`);
  console.log(`  被总结的部分：#0 ~ #${p.firstKeptEntryIndex - 1}，共 ${p.firstKeptEntryIndex} 条消息\n`);
  assert.equal(p.firstKeptEntryIndex, c.firstKept, `${c.title}：切点`);
  assert.equal(p.isSplitTurn, c.split, `${c.title}：split turn`);
  assert.notEqual(msgs[p.firstKeptEntryIndex].role, 'toolResult', `${c.title}：切点不能是工具结果`);
}
