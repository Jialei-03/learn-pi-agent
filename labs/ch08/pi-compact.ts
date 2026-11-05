// 第 8 章实验：Pi 完整地压缩一次——发给摘要模型的是什么，压缩前后上下文差多少，文件清单怎么来。
//   node labs/ch08/pi-compact.ts
// 摘要模型用 Pi 的 faux 脚本代替（返回固定格式的摘要），重点是观察请求的形状。
import assert from 'node:assert/strict';
import { SessionManager, compact as piCompact } from '@earendil-works/pi-coding-agent';
import { prepareCompaction } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js';
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';

const SUMMARY = '## 目标\n给 mox-notes 加上 list 命令\n\n## 进展\n### 已完成\n- [x] 读了 src/cli.ts\n\n## 下一步\n1. 修改 src/cli.ts';
const pi = SessionManager.inMemory('/repo');
for (let t = 1; t <= 4; t++) {
  pi.appendMessage({ role: 'user', content: `第 ${t} 步：看看 src/file${t}.ts`, timestamp: 0 });
  pi.appendMessage(fauxAssistantMessage(fauxToolCall(t === 3 ? 'edit' : 'read', { path: `src/file${t}.ts` }, { id: `c${t}` }), { stopReason: 'toolUse' }));
  pi.appendMessage({ role: 'toolResult', toolCallId: `c${t}`, toolName: 'read', content: [{ type: 'text', text: 'x'.repeat(1600) }], isError: false, timestamp: 0 } as any);
  pi.appendMessage(fauxAssistantMessage(`第 ${t} 步完成。`));
}
const preparation = prepareCompaction(pi.getBranch(), { enabled: true, reserveTokens: 16384, keepRecentTokens: 500 })!;
const faux = createFauxCore({});
const requests: { system: string; prompt: string }[] = [];
const respond = (context: any) => {
  const user = context.messages.find((m: any) => m.role === 'user');
  requests.push({ system: String(context.messages[0].content), prompt: user.content.map((b: any) => b.text).join('') });
  return fauxAssistantMessage(SUMMARY);
};
faux.setResponses([respond, respond]);                   // 切开一轮时，Pi 会发两次摘要请求
const result = await piCompact(preparation, faux.getModel(), 'test', undefined, undefined, undefined, undefined, (m: any, c: any, o: any) => faux.streamSimple(m, c, o));

console.log(`要总结的消息：${preparation.messagesToSummarize.length} 条；被切开那一轮的前半段：${preparation.turnPrefixMessages.length} 条；从第 ${pi.getBranch().findIndex(e => e.id === result.firstKeptEntryId)} 条记录开始保留`);
console.log(`摘要请求次数：${requests.length}（历史一份 + 被切开那一轮的前半段一份，再合并）`);
console.log(`摘要模型的系统提示：${requests[0].system.slice(0, 60)}……`);
console.log('发给摘要模型的请求（节选）：');
console.log(requests[0].prompt.split('\n').slice(0, 7).map(l => '  │ ' + l.slice(0, 70)).join('\n'));
console.log('  │ ……');
console.log(`摘要末尾的文件清单：${result.summary.match(/<(read|modified)-files>[\s\S]*?<\/\1-files>/g)?.map(s => s.replace(/\n/g, ' ')).join('  ')}`);
assert.equal(preparation.messagesToSummarize.length, 8);
assert.equal(preparation.turnPrefixMessages.length, 3);
assert.equal(requests.length, 2);
assert.equal(pi.getBranch().findIndex(e => e.id === result.firstKeptEntryId), 11);
assert.ok(result.summary.includes('<read-files>\nsrc/file1.ts\nsrc/file2.ts\n</read-files>'));
assert.ok(result.summary.includes('<modified-files>\nsrc/file3.ts\n</modified-files>'));
