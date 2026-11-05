// 第 8 章用的一段修 bug 的对话：用户报告搜索不区分大小写，Agent 读代码、改代码、跑测试，测试还剩一个失败。
import type { Msg } from '../../mox/src/model.ts';

const call = (id: string, name: string, args: object): Msg => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const result = (id: string, content: string): Msg => ({ role: 'tool', tool_call_id: id, content });

export const conversation = (): Msg[] => [
  { role: 'user', content: 'mox search 搜 "Todo" 搜不到 "todo" 的笔记，帮我修一下。不要引入新的依赖。' },
  call('c1', 'read', { path: 'src/search.ts' }),
  result('c1', 'export function search(notes: string[], q: string) {\n  return notes.filter(n => n.includes(q));\n}'),
  call('c2', 'edit', { path: 'src/search.ts', edits: [{ oldText: 'n.includes(q)', newText: 'n.toLowerCase().includes(q.toLowerCase())' }] }),
  result('c2', '已修改 src/search.ts'),
  call('c3', 'bash', { command: 'npm test' }),
  result('c3', ' PASS  test/search.test.ts\n FAIL  test/search-unicode.test.ts\n  ● 土耳其语 İ 的小写不应变成 i̇\n    Expected: "istanbul"\n    Received: "i̇stanbul"\n\nTests: 1 failed, 6 passed [退出码 1]'),
  { role: 'assistant', content: '大小写问题修好了，但 test/search-unicode.test.ts 里有一个关于土耳其语 İ 的用例失败：toLowerCase 会把 İ 变成 i̇（带一个组合点）。我建议改用 localeCompare 的 sensitivity: "base"，或者先做 NFKC 归一化。要我继续吗？' },
  { role: 'user', content: '用 localeCompare 那个方案。另外以后改完都要跑一遍 npm run lint。' },
  { role: 'assistant', content: '好的，我先看一下 lint 配置。' },
];
