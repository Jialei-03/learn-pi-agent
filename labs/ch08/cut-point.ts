// 第 8 章实验：压缩时从哪里切？
//   node labs/ch08/cut-point.ts
// 构造一段 5 轮的对话（每轮：用户提问 → 模型调用 read → 工具结果 → 模型回答），
// 设定“至少保留最近约 N 个 token”，分别交给 mox 和 Pi 的 findCutPoint。
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, findCutPoint as piFindCutPoint } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { findCutPoint } from '../../mox/src/compaction.ts';
import type { Message } from '../../mox/src/types.ts';

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
function conversation(turns: number, hugeTurn?: number): { mox: Message[]; pi: any[] } {
  const mox: Message[] = [];
  const pi: any[] = [];
  for (let t = 1; t <= turns; t++) {
    const fileSize = t === hugeTurn ? 6000 : 800;              // 某一轮读了一个特别大的文件
    const body = `// file${t}.ts\n` + 'x'.repeat(fileSize);
    mox.push({ role: 'user', content: `问题 ${t}` });
    mox.push({ role: 'assistant', stopReason: 'toolUse', usage, content: [{ type: 'toolCall', id: `c${t}`, name: 'read', arguments: { path: `src/file${t}.ts` } }] });
    mox.push({ role: 'toolResult', toolCallId: `c${t}`, toolName: 'read', content: body, isError: false });
    mox.push({ role: 'assistant', stopReason: 'stop', usage, content: [{ type: 'text', text: `回答 ${t}` }] });
    pi.push({ role: 'user', content: `问题 ${t}`, timestamp: 0 });
    pi.push(fauxAssistantMessage(fauxToolCall('read', { path: `src/file${t}.ts` }, { id: `c${t}` }), { stopReason: 'toolUse' }));
    pi.push({ role: 'toolResult', toolCallId: `c${t}`, toolName: 'read', content: [{ type: 'text', text: body }], isError: false, timestamp: 0 });
    pi.push(fauxAssistantMessage(`回答 ${t}`));
  }
  return { mox, pi };
}

const label = (m: Message, i: number) => `#${i} ${m.role === 'user' ? m.content : m.role === 'toolResult' ? '工具结果' : m.content[0].type === 'toolCall' ? '模型调用 read' : (m.content[0] as any).text}`;

for (const c of [
  { title: '情形一：额度恰好在一轮的开头用完', turns: 5, keep: 424, huge: undefined, firstKept: 12, split: false },
  { title: '情形二：额度在一轮的中间用完', turns: 5, keep: 450, huge: undefined, firstKept: 11, split: true },
  { title: '情形三：最近一轮特别大，单独就超过了保留额度', turns: 5, keep: 450, huge: 5, firstKept: 19, split: true },
]) {
  const { mox, pi } = conversation(c.turns, c.huge);
  const m = findCutPoint(mox, c.keep);
  const session = SessionManager.inMemory('/repo');
  for (const msg of pi) session.appendMessage(msg);
  const entries = session.getEntries();
  const p = piFindCutPoint(entries, 0, entries.length, c.keep);
  console.log(`${c.title}（保留约 ${c.keep} tokens）`);
  console.log(`  mox：从 ${label(mox[m.firstKeptIndex], m.firstKeptIndex)} 开始保留，split turn = ${m.isSplitTurn}`);
  console.log(`  Pi ：从 ${label(mox[p.firstKeptEntryIndex], p.firstKeptEntryIndex)} 开始保留，split turn = ${p.isSplitTurn}`);
  console.log(`  被总结的部分：#0 ~ #${m.firstKeptIndex - 1}，共 ${m.firstKeptIndex} 条消息\n`);
  // 正文说两者在三种情形下的切点和 split turn 判断完全一致；切点绝不能落在工具结果上
  assert.equal(m.firstKeptIndex, c.firstKept, `${c.title}：mox 的切点`);
  assert.equal(p.firstKeptEntryIndex, c.firstKept, `${c.title}：Pi 的切点`);
  assert.equal(m.isSplitTurn, c.split, `${c.title}：mox 的 split turn`);
  assert.equal(p.isSplitTurn, c.split, `${c.title}：Pi 的 split turn`);
  assert.notEqual(mox[m.firstKeptIndex].role, 'toolResult', `${c.title}：切点不能是工具结果`);
}
