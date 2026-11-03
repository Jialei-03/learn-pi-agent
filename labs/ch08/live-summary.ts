// 第 8 章：让真实模型写一份压缩摘要（需要 MOX_API_KEY，不在网站构建时运行）。
//   node labs/ch08/live-summary.ts
// 一段修 bug 的对话：用户报告搜索不区分大小写的问题，Agent 读代码、改代码、跑测试，测试还剩一个失败。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelFromEnv } from '../../mox/src/cli.ts';
import { compactSession } from '../../mox/src/compaction.ts';
import { Session } from '../../mox/src/session.ts';
import type { Message } from '../../mox/src/types.ts';

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const call = (id: string, name: string, args: object): Message => ({ role: 'assistant', stopReason: 'toolUse', usage, content: [{ type: 'toolCall', id, name, arguments: args as Record<string, unknown> }] });
const result = (id: string, name: string, content: string, isError = false): Message => ({ role: 'toolResult', toolCallId: id, toolName: name, content, isError });
const say = (text: string): Message => ({ role: 'assistant', stopReason: 'stop', usage, content: [{ type: 'text', text }] });

const conversation: Message[] = [
  { role: 'user', content: 'mox search 搜 "Todo" 搜不到 "todo" 的笔记，帮我修一下。不要引入新的依赖。' },
  call('c1', 'read', { path: 'src/search.ts' }),
  result('c1', 'read', 'export function search(notes: string[], q: string) {\n  return notes.filter(n => n.includes(q));\n}'),
  call('c2', 'edit', { path: 'src/search.ts', edits: [{ oldText: 'n.includes(q)', newText: 'n.toLowerCase().includes(q.toLowerCase())' }] }),
  result('c2', 'edit', '已替换 src/search.ts 中的 1 处内容。'),
  call('c3', 'bash', { command: 'npm test' }),
  result('c3', 'bash', ' PASS  test/search.test.ts\n FAIL  test/search-unicode.test.ts\n  ● 土耳其语 İ 的小写不应变成 i̇\n    Expected: "istanbul"\n    Received: "i̇stanbul"\n\nTests: 1 failed, 6 passed\n\n命令退出码 1', true),
  say('大小写问题修好了，但 test/search-unicode.test.ts 里有一个关于土耳其语 İ 的用例失败：toLowerCase 会把 İ 变成 i̇（带一个组合点）。我建议改用 localeCompare 的 sensitivity: "base"，或者先做 NFKC 归一化。要我继续吗？'),
  { role: 'user', content: '用 localeCompare 那个方案。另外以后改完都要跑一遍 npm run lint。' },
  say('好的，我先看一下 lint 配置。'),
];

const session = Session.create('/repo', join(mkdtempSync(join(tmpdir(), 'ch08-live-')), 's'));
for (const m of conversation) session.appendMessage(m);
const model = modelFromEnv();
const r = await compactSession(session, model, { keepRecentTokens: 40 });
console.log(`模型：${model.id}；压缩了 ${r.summarized} 条消息，保留最近 ${r.kept} 条\n`);
console.log(r.summary);
