// 第 8 章实验：压缩时从哪里切？mox 的切点和 Pi 的切点。
//   node labs/ch08/cut-point.ts
// 5 轮对话，每轮：用户提问 → 模型调用 read → 工具结果 → 模型回答。设定“至少保留约 N 个 token”，
// mox 用真实的 compact()，Pi 用真实的 findCutPoint。两边估算 token 的方式不同，所以同一种情形用的额度数字不同。
import assert from 'node:assert/strict';
import { SessionManager, findCutPoint as piFindCutPoint } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { compact } from '../../mox/src/compact.ts';
import type { Msg } from '../../mox/src/model.ts';
import { scripted } from '../shared/scripted.ts';

function conversation(turns: number, hugeTurn?: number): { mox: Msg[]; pi: any[] } {
  const mox: Msg[] = [];
  const pi: any[] = [];
  for (let t = 1; t <= turns; t++) {
    const body = `// file${t}.ts\n` + 'x'.repeat(t === hugeTurn ? 6000 : 800);      // 某一轮读了一个特别大的文件
    mox.push({ role: 'user', content: `问题 ${t}` });
    mox.push({ role: 'assistant', content: null, tool_calls: [{ id: `c${t}`, type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: `src/file${t}.ts` }) } }] });
    mox.push({ role: 'tool', tool_call_id: `c${t}`, content: body });
    mox.push({ role: 'assistant', content: `回答 ${t}` });
    pi.push({ role: 'user', content: `问题 ${t}`, timestamp: 0 });
    pi.push(fauxAssistantMessage(fauxToolCall('read', { path: `src/file${t}.ts` }, { id: `c${t}` }), { stopReason: 'toolUse' }));
    pi.push({ role: 'toolResult', toolCallId: `c${t}`, toolName: 'read', content: [{ type: 'text', text: body }], isError: false, timestamp: 0 });
    pi.push(fauxAssistantMessage(`回答 ${t}`));
  }
  return { mox, pi };
}

const label = (m: Msg) => (m.role === 'user' && !m.content.startsWith('（') ? m.content : m.role === 'tool' ? '工具结果' : m.role === 'assistant' && m.tool_calls ? '模型调用 read' : m.role === 'assistant' ? m.content : '摘要');
const rows: string[] = ['| 情形 | mox 保留 | Pi 保留 | Pi 是否切开一轮 |', '| --- | --- | --- | --- |'];

for (const c of [
  { title: '额度正好够最近两轮', moxKeep: 600, piKeep: 424, huge: undefined, moxKept: 8, piFirstKept: 12, split: false },
  { title: '额度落在一轮的中间', moxKeep: 450, piKeep: 450, huge: undefined, moxKept: 4, piFirstKept: 11, split: true },
  { title: '最近一轮特别大，单独就超过额度', moxKeep: 450, piKeep: 450, huge: 5, moxKept: 0, piFirstKept: 19, split: true },
]) {
  const { mox, pi } = conversation(5, c.huge);
  const all = mox.slice();
  const result = await compact(mox, scripted([{ text: '（摘要）' }]), c.moxKeep);
  const session = SessionManager.inMemory('/repo');
  for (const msg of pi) session.appendMessage(msg);
  const entries = session.getEntries();
  const p = piFindCutPoint(entries, 0, entries.length, c.piKeep);

  const moxFirst = result!.keep === 0 ? '什么都不保留（全部进了摘要）' : `从「${label(mox[1])}」开始，共 ${result!.keep} 条`;
  const piFirst = `从 #${p.firstKeptEntryIndex}「${label(all[p.firstKeptEntryIndex])}」开始，共 ${all.length - p.firstKeptEntryIndex} 条`;
  rows.push(`| ${c.title} | ${moxFirst} | ${piFirst} | ${p.isSplitTurn ? '是' : '否'} |`);
  assert.equal(result!.keep, c.moxKept, `${c.title}：mox 保留几条`);
  assert.equal(p.firstKeptEntryIndex, c.piFirstKept, `${c.title}：Pi 的切点`);
  assert.equal(p.isSplitTurn, c.split, `${c.title}：Pi 是否切开一轮`);
  if (result!.keep) assert.equal(mox[1].role, 'user', 'mox 保留的部分一定从用户消息开始');
}
console.log(rows.join('\n'));
console.log('\nmox 保留下来的部分总是从一条用户消息开始；额度落在一轮中间时少保留，最近一轮自己就超额时一条也不留。');
