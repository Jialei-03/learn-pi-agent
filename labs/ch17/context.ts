// 第 17 章实验：子 Agent 省的是什么、花的是什么。
//   node labs/ch17/context.ts
// 同一个问题“压缩时从哪里切开？”，主 Agent 自己读三个文件，或者交给 explore 子 Agent。读的是本仓库 mox 的真实源码。
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodingTools } from '../../mox/src/coding/index.ts';
import { runLoop } from '../../mox/src/loop.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import { BUILTIN_AGENTS, createAgentTool } from '../../mox/src/subagent.ts';
import type { Context, Message } from '../../mox/src/types.ts';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const files = ['mox/src/compaction.ts', 'mox/src/session.ts', 'mox/src/loop.ts'];
const answer = '切点由 mox/src/compaction.ts 的 findCutPoint 决定：从末尾往前累计约 20000 token，并且只停在 user 或 assistant 消息上，绝不切在 toolResult 上（否则工具调用和结果会被拆散）。session.ts 的 appendCompaction 记录 firstKeptId，messages() 据此重建上下文。';
const reads = (prefix: string) => files.map((path, i) => ({ id: `${prefix}${i}`, name: 'read', arguments: { path } }));
const isChild = (c: Context) => c.systemPrompt.includes('负责调研的子 Agent');

// 每个请求的输入大小（字符数），按是谁发出的分别记账
const sizes = { parent: [] as number[], child: [] as number[] };
const model = (plan: (c: Context, n: number) => any) => {
  let n = 0;
  const inner = scripted((c) => plan(c, ++n));
  return { id: 'scripted', stream: (c: Context, o: any) => { (isChild(c) ? sizes.child : sizes.parent).push(JSON.stringify(c).length); return inner.stream(c, o); } };
};
const tools = createCodingTools(repo);
const question = '压缩时从哪里切开对话？只要结论和位置。';

// A：主 Agent 自己读
const direct = model((_c, n) => (n === 1 ? { toolCalls: files.map((path, i) => ({ id: `r${i}`, name: 'read', arguments: { path } })) } : { text: answer }));
const a = await runLoop([], [{ role: 'user', content: question }], { model: direct, systemPrompt: '你是 mox。', tools });
const parentA = [...sizes.parent];

// B：交给 explore 子 Agent
sizes.parent = []; sizes.child = [];
let parentTurn = 0, childTurn = 0;
const shared = model(c => {
  if (isChild(c)) return ++childTurn === 1 ? { toolCalls: reads('c') } : { text: answer };
  return ++parentTurn === 1
    ? { toolCalls: [{ id: 'a1', name: 'agent', arguments: { agent: 'explore', task: '在 mox/src 里找出压缩（compaction）时决定从哪里切开对话的逻辑。返回：结论、函数名和文件位置，不要贴代码。' } }] }
    : { text: answer };
});
const agentTool = createAgentTool({ model: shared, tools: () => [...tools, agentTool], agents: BUILTIN_AGENTS, cwd: repo });
const b = await runLoop([], [{ role: 'user', content: question }], { model: shared, systemPrompt: '你是 mox。', tools: [...tools, agentTool] });

const ctx = (ms: Message[]) => JSON.stringify(ms).length;
const k = (n: number) => `${(n / 1000).toFixed(1)}K`;
console.log('| | 主对话最后的上下文 | 主 Agent 发出的输入（累计） | 子 Agent 发出的输入（累计） | 合计 |');
console.log('| --- | --- | --- | --- | --- |');
const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
console.log(`| A 自己读三个文件 | ${k(ctx(a.messages))} 字符 | ${k(sum(parentA))} | — | ${k(sum(parentA))} |`);
console.log(`| B 交给 explore | ${k(ctx(b.messages))} 字符 | ${k(sum(sizes.parent))} | ${k(sum(sizes.child))} | ${k(sum(sizes.parent) + sum(sizes.child))} |`);
const result = b.messages.find(m => m.role === 'toolResult');
console.log(`\n主 Agent 从子 Agent 那里拿到的全部内容（${result?.role === 'toolResult' ? result.content.length : 0} 个字符）：\n  ${result?.role === 'toolResult' ? result.content : ''}`);
