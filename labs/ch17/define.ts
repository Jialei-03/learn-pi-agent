// 第 17 章实验：自己定义子 Agent——用一个扩展（labs/ch17/agents.ts）补上 mox 没有的三样东西：
// 命名的定义、按定义筛选的工具、有并发上限的并行。模型是脚本，子 Agent 里的命令是真的 sleep 和真的文件。
//   node labs/ch17/define.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadExtensions } from '../../mox/src/extensions.ts';
import type { Tool } from '../../mox/src/loop.ts';
import { codingTools } from '../../mox/src/tools.ts';
import { scripted, type Script } from '../shared/scripted.ts';
import { agentsExtension } from './agents.ts';

const cwd = mkdtempSync(join(tmpdir(), 'ch17-define-'));
mkdirSync(join(cwd, 'agents'));
writeFileSync(join(cwd, 'agents', 'explore.md'), '---\nname: explore\ndescription: 只读地查找和阅读代码，返回结论和位置。\ntools: read, grep, find, ls\n---\n你是调研子 Agent。只读，不修改任何文件。回答要短：结论和位置。\n');
writeFileSync(join(cwd, 'agents', 'worker.md'), '---\nname: worker\ndescription: 可以执行命令的通用子 Agent。\ntools: read, bash\n---\n你是通用子 Agent，独立完成任务后汇报。\n');
writeFileSync(join(cwd, 'notes.txt'), '这个项目用 node test.js 运行测试。\n');

/** 加载扩展，返回它注册的 agent 工具。script 是子 Agent 用的脚本模型 */
async function agentTool(script: Script, options: { limit?: number; approve?: (agent: string, tool: string, args: any) => Promise<boolean> } = {}) {
  const tools: Tool[] = codingTools(cwd);
  await loadExtensions([agentsExtension({ dirs: [join(cwd, 'agents')], model: scripted(script), approve: async () => true, ...options })], { cwd, tools, ask: async () => undefined });
  return tools.find(t => t.name === 'agent')!;
}
const firstUser = (messages: any[]) => messages.find(m => m.role === 'user').content as string;
const hasResult = (messages: any[]) => messages.some(m => m.role === 'tool');

// ── ① 定义文件变成了工具描述 ──
const base = await agentTool(() => ({ text: '' }));
console.log('① 工具描述里列出的子 Agent（来自 agents/*.md）：');
console.log(base.description.split('\n').filter(l => l.startsWith('- ')).join('\n'));

// ── ② 并行，有上限 ──
const events: { at: number; kind: string; id: string }[] = [];
let t0 = 0;
const waiting = await agentTool((messages) => {
  t0 ||= Date.now();
  const id = firstUser(messages).slice(0, 2);
  events.push({ at: Date.now() - t0, kind: hasResult(messages) ? '完成' : '开始', id });
  return hasResult(messages) ? { text: `${id} 完成` } : { toolCalls: [{ name: 'bash', arguments: { command: 'sleep 0.4' } }] };
}, { limit: 2 });
const out = await waiting.run({ tasks: [1, 2, 3, 4].map(i => ({ agent: 'worker', prompt: `#${i} 等一会儿再汇报` })) });
const slot = (ms: number) => (Math.floor(ms / 400) * 0.4).toFixed(1);   // 每条命令至少 0.4 秒：向下取整到 0.4 秒的格子，每次输出都一样
console.log('\n② 四个任务，最多同时两个（每个任务里是一条 0.4 秒的命令）：');
console.log(events.map(e => ({ ...e, slot: slot(e.at) }))
  .sort((a, b) => a.slot.localeCompare(b.slot) || (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === '完成' ? -1 : 1))
  .map(e => `约 ${e.slot}s ${e.kind} ${e.id}`).join('\n'));
console.log(`交回的结果按任务顺序排列：${out.split('\n').filter(l => l.startsWith('## ')).map(l => l.slice(3, 12)).join('、')}`);

// ── ③ 只读的 explore：想写文件，工具根本不存在 ──
const readonly = await agentTool((messages) => (hasResult(messages)
  ? { text: `我尝试写文件，得到：${messages.filter(m => m.role === 'tool').at(-1)!.content}` }
  : { toolCalls: [{ name: 'write', arguments: { path: 'hack.txt', content: 'x' } }] }));
const readonlyOut = await readonly.run({ agent: 'explore', prompt: '读 notes.txt，顺手写个文件' });
console.log(`\n③ explore 汇报：${readonlyOut}\n   hack.txt 存在吗：${existsSync(join(cwd, 'hack.txt'))}`);

// ── ④ worker 的 bash 先过审批 ──
const asked: string[] = [];
const guarded = await agentTool((messages) => (hasResult(messages)
  ? { text: `结果：${messages.filter(m => m.role === 'tool').map(m => m.content).join(' | ')}` }
  : { toolCalls: [{ name: 'bash', arguments: { command: 'rm -rf build' } }, { name: 'bash', arguments: { command: 'ls' } }] }),
{ approve: async (agent, tool, args) => { asked.push(`${agent}:${tool}(${args.command})`); return !/\brm\b/.test(args.command); } });
const guardedOut = await guarded.run({ agent: 'worker', prompt: '清理 build 再看看目录' });
console.log(`\n④ 审批函数被问到：${asked.join('；')}\n   worker 汇报：${guardedOut.replace(/\n/g, ' ')}`);

// ── ⑤ 取消 ──
const slow = await agentTool((messages) => (hasResult(messages) ? { text: '不会走到这里' } : { toolCalls: [{ name: 'bash', arguments: { command: 'sleep 5' } }] }));
const controller = new AbortController();
setTimeout(() => controller.abort(), 300);
const began = Date.now();
const aborted = await slow.run({ agent: 'worker', prompt: '睡一会儿' }, controller.signal).catch(e => `抛出 ${(e as Error).name}`);
const seconds = (Date.now() - began) / 1000;
console.log(`\n⑤ 命令本来要跑 5 秒，取消后 ${seconds.toFixed(1)} 秒就返回了：${aborted}`);

assert.deepEqual(events.slice(0, 2).map(e => `${e.kind}${e.id}`), ['开始#1', '开始#2'], '一开始只启动两个');
const finishedAt = (id: string) => events.find(e => e.id === id && e.kind === '完成')!.at;
assert.ok(events.find(e => e.id === '#3' && e.kind === '开始')!.at >= Math.min(finishedAt('#1'), finishedAt('#2')), '#3 要等名额空出来');
assert.ok(!existsSync(join(cwd, 'hack.txt')));
assert.match(readonlyOut, /没有名为 write 的工具/);
assert.deepEqual(asked, ['worker:bash(rm -rf build)', 'worker:bash(ls)']);
assert.match(guardedOut, /用户拒绝了这次调用/);
assert.ok(seconds < 3);
