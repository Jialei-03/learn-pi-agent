// 第 8 章实验：完整地压缩一次，看看发给“摘要模型”的是什么，压缩前后上下文差多少。
//   node labs/ch08/compact.ts
// 摘要模型用脚本代替（返回固定格式的摘要），重点是观察请求的形状，以及会话文件里留下了什么。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, compact as piCompact } from '@earendil-works/pi-coding-agent';
import { prepareCompaction } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js';
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { compactSession, estimateMessageTokens } from '../../mox/src/compaction.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import { Session } from '../../mox/src/session.ts';
import type { Message } from '../../mox/src/types.ts';

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const SUMMARY = '## 目标\n给 mox-notes 加上 list 命令\n\n## 进展\n### 已完成\n- [x] 读了 src/cli.ts\n\n## 下一步\n1. 修改 src/cli.ts';

// ── mox ──────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'ch08-'));
const session = Session.create('/repo', join(dir, 'mox'));
for (let t = 1; t <= 4; t++) {
  session.appendMessage({ role: 'user', content: `第 ${t} 步：看看 src/file${t}.ts` });
  session.appendMessage({ role: 'assistant', stopReason: 'toolUse', usage, content: [{ type: 'toolCall', id: `c${t}`, name: t === 3 ? 'edit' : 'read', arguments: { path: `src/file${t}.ts` } }] });
  session.appendMessage({ role: 'toolResult', toolCallId: `c${t}`, toolName: 'read', content: 'x'.repeat(1600), isError: false });
  session.appendMessage({ role: 'assistant', stopReason: 'stop', usage, content: [{ type: 'text', text: `第 ${t} 步完成。` }] });
}
const tokens = (ms: Message[]) => ms.reduce((n, m) => n + estimateMessageTokens(m), 0);
const before = session.messages();
let seenPrompt = '';
const summarizer = scripted(ctx => { seenPrompt = (ctx.messages[0] as { content: string }).content; return { text: SUMMARY }; });
const r1 = await compactSession(session, summarizer, { keepRecentTokens: 500 });
const after = session.messages();
console.log('━━ mox ━━');
console.log(`压缩前：${before.length} 条消息，约 ${tokens(before)} tokens`);
console.log(`压缩后：${after.length} 条消息，约 ${tokens(after)} tokens（1 条摘要 + 保留的 ${r1.kept} 条）`);
const fileLines = readFileSync(session.file!, 'utf8').trim().split('\n').length;
console.log(`会话文件：${fileLines} 行——原始消息一条没删，只多了一条 compaction 记录`);
// 正文引用的数字（第 8 章“约 1660 → 475”）：估算方式或切点变了，这里要报错，提醒同步修改正文
assert.equal(before.length, 16);
assert.equal(tokens(before), 1660);
assert.equal(after.length, 6);
assert.equal(r1.kept, 5);
assert.equal(tokens(after), 475);
assert.equal(fileLines, 1 + 16 + 1, '会话文件 = 1 行文件头 + 16 条原始消息 + 1 条 compaction 记录');
console.log('\n发给摘要模型的请求（节选）：');
console.log(seenPrompt.split('\n').slice(0, 9).map(l => '  │ ' + l.slice(0, 70)).join('\n'));
console.log('  │ ……');
console.log('\n摘要末尾自动附上的文件清单：');
console.log(r1.summary.split('\n').filter(l => /files>|^src\//.test(l)).map(l => '  │ ' + l).join('\n'));
assert.ok(r1.summary.includes('<read-files>\nsrc/file1.ts\nsrc/file2.ts\n</read-files>'));
assert.ok(r1.summary.includes('<modified-files>\nsrc/file3.ts\n</modified-files>'));

// 第二次压缩：上一次的摘要作为 <previous-summary> 传入，要求“合并”而不是重写
for (let t = 5; t <= 6; t++) {
  session.appendMessage({ role: 'user', content: `第 ${t} 步` });
  session.appendMessage({ role: 'assistant', stopReason: 'stop', usage, content: [{ type: 'text', text: 'y'.repeat(1600) }] });
}
await compactSession(session, summarizer, { keepRecentTokens: 300 });
console.log(`\n第二次压缩时，请求里包含上一份摘要：${seenPrompt.includes('<previous-summary>') ? '是' : '否'}`);
assert.ok(seenPrompt.includes('<previous-summary>'), '第二次压缩要把上一份摘要作为 <previous-summary> 传给模型');

// ── Pi ───────────────────────────────────────────────
const pi = SessionManager.inMemory('/repo');
for (let t = 1; t <= 4; t++) {
  pi.appendMessage({ role: 'user', content: `第 ${t} 步：看看 src/file${t}.ts`, timestamp: 0 });
  pi.appendMessage(fauxAssistantMessage(fauxToolCall(t === 3 ? 'edit' : 'read', { path: `src/file${t}.ts` }, { id: `c${t}` }), { stopReason: 'toolUse' }));
  pi.appendMessage({ role: 'toolResult', toolCallId: `c${t}`, toolName: 'read', content: [{ type: 'text', text: 'x'.repeat(1600) }], isError: false, timestamp: 0 } as any);
  pi.appendMessage(fauxAssistantMessage(`第 ${t} 步完成。`));
}
const preparation = prepareCompaction(pi.getBranch(), { enabled: true, reserveTokens: 16384, keepRecentTokens: 500 });
const faux = createFauxCore({});
const piRequests: { system: string; prompt: string }[] = [];
const respond = (context: any) => {
  const user = context.messages.find((m: any) => m.role === 'user');
  piRequests.push({ system: String(context.messages[0].content), prompt: user.content.map((b: any) => b.text).join('') });
  return fauxAssistantMessage(SUMMARY);
};
faux.setResponses([respond, respond]);                   // 切开一轮时，Pi 会发两次摘要请求
const result = await piCompact(preparation!, faux.getModel(), 'test', undefined, undefined, undefined, undefined, (m: any, c: any, o: any) => faux.streamSimple(m, c, o));
const [piSystem, piPrompt] = [piRequests[0].system, piRequests[0].prompt];
console.log('\n━━ Pi ━━');
console.log(`要总结的消息：${preparation!.messagesToSummarize.length} 条；被切开那一轮的前半段：${preparation!.turnPrefixMessages.length} 条；从第 ${pi.getBranch().findIndex(e => e.id === result.firstKeptEntryId)} 条记录开始保留`);
console.log(`摘要请求次数：${piRequests.length}（历史一份 + 被切开那一轮的前半段一份，再合并）`);
console.log(`摘要模型的系统提示：${String(piSystem).slice(0, 60)}……`);
console.log('发给摘要模型的请求（节选）：');
console.log(piPrompt.split('\n').slice(0, 7).map(l => '  │ ' + l.slice(0, 70)).join('\n'));
console.log('  │ ……');
console.log(`摘要末尾的文件清单：${result.summary.match(/<(read|modified)-files>[\s\S]*?<\/\1-files>/g)?.map(s => s.replace(/\n/g, ' ')).join('  ')}`);
// 正文说“Pi 发了两次摘要请求，因为切点落在了一轮的中间”
assert.equal(preparation!.messagesToSummarize.length, 8);
assert.equal(preparation!.turnPrefixMessages.length, 3);
assert.equal(piRequests.length, 2);
assert.equal(pi.getBranch().findIndex(e => e.id === result.firstKeptEntryId), 11);
assert.ok(result.summary.includes('<read-files>\nsrc/file1.ts\nsrc/file2.ts\n</read-files>'));
assert.ok(result.summary.includes('<modified-files>\nsrc/file3.ts\n</modified-files>'));
