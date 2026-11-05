// 第 8 章：用真实模型录制 Pi 的压缩（需要 MOX_API_KEY；网站构建时不运行）。
//   eval "$(python3 /tmp/mox-keys.py minimax)"
//   node labs/ch08/record.ts            录制 Pi 的摘要（recorded/pi-summary.json）
//   node labs/ch08/record.ts mox        录制 mox 的摘要和 token 用量（recorded/summary.json、tokens.json）
// Pi 一侧：把一段修 bug 的对话放进真实的 SessionManager，用 Pi 真实的 prepareCompaction + compact，
// 模型是 Pi 自带的 MiniMax-M3.1-Flash（minimax-cn 提供方）。
import { writeFileSync } from 'node:fs';
import { SessionManager, compact as piCompact } from '@earendil-works/pi-coding-agent';
import { prepareCompaction } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js';
import { getModel, streamSimple } from '@earendil-works/pi-ai/compat';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';

const out = (name: string) => new URL(`./recorded/${name}`, import.meta.url);
const apiKey = process.env.MOX_API_KEY;
if (!apiKey) throw new Error('需要设置 MOX_API_KEY（eval "$(python3 /tmp/mox-keys.py minimax)"）');

if (process.argv[2] === 'mox') {
  await import('./record-mox.ts');
} else {
  const model = getModel('minimax-cn', 'MiniMax-M3.1-Flash') as any;
  const session = SessionManager.inMemory('/repo');
  const user = (t: string) => ({ role: 'user' as const, content: t, timestamp: 0 });
  const call = (id: string, name: string, args: object) => fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: 'toolUse' });
  const result = (id: string, name: string, text: string, isError = false) => ({ role: 'toolResult' as const, toolCallId: id, toolName: name, content: [{ type: 'text' as const, text }], isError, timestamp: 0 }) as any;
  for (const m of [
    user('先看看项目结构。'),
    call('c0', 'bash', { command: 'ls' }),
    result('c0', 'bash', 'README.md\nsrc\ntest'),
    fauxAssistantMessage('有 README.md、src/ 和 test/。'),
    user('mox search 搜 "Todo" 搜不到 "todo" 的笔记，帮我修一下。不要引入新的依赖。'),
    call('c1', 'read', { path: 'src/search.ts' }),
    result('c1', 'read', 'export function search(notes: string[], q: string) {\n  return notes.filter(n => n.includes(q));\n}'),
    call('c2', 'edit', { path: 'src/search.ts', edits: [{ oldText: 'n.includes(q)', newText: 'n.toLowerCase().includes(q.toLowerCase())' }] }),
    result('c2', 'edit', '已修改 src/search.ts'),
    call('c3', 'bash', { command: 'npm test' }),
    result('c3', 'bash', ' PASS  test/search.test.ts\n FAIL  test/search-unicode.test.ts\n  ● 土耳其语 İ 的小写不应变成 i̇\n    Expected: "istanbul"\n    Received: "i̇stanbul"\n\nTests: 1 failed, 6 passed', true),
    fauxAssistantMessage('大小写问题修好了，但 test/search-unicode.test.ts 里有一个关于土耳其语 İ 的用例失败：toLowerCase 会把 İ 变成 i̇（带一个组合点）。我建议改用 localeCompare 的 sensitivity: "base"，或者先做 NFKC 归一化。要我继续吗？'),
    user('用 localeCompare 那个方案。另外以后改完都要跑一遍 npm run lint。'),
    fauxAssistantMessage('好的，我先看一下 lint 配置。'),
  ]) session.appendMessage(m);
  const preparation = prepareCompaction(session.getBranch(), { enabled: true, reserveTokens: 16384, keepRecentTokens: 60 });
  if (!preparation) throw new Error('没有可压缩的内容');
  const result_ = await piCompact(preparation, model, apiKey, undefined, undefined, undefined, undefined, streamSimple as any);
  writeFileSync(out('pi-summary.json'), JSON.stringify({
    model: `${model.provider}/${model.id}`, recordedAt: new Date().toISOString().slice(0, 10), keepRecentTokens: 60,
    summarized: preparation.messagesToSummarize.length, turnPrefix: preparation.turnPrefixMessages.length, isSplitTurn: preparation.isSplitTurn,
    summary: result_.summary,
  }, null, 2) + '\n');
  console.log(result_.summary);
}
