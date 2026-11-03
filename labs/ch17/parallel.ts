// 第 17 章实验：并行、取消、权限继承。
//   node labs/ch17/parallel.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodingTools } from '../../mox/src/coding/index.ts';
import { ExtensionHost } from '../../mox/src/extensions.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import { BUILTIN_AGENTS, createAgentTool } from '../../mox/src/subagent.ts';
import { createPermissionsMoxExtension } from '../../extensions/permissions/mox.ts';
import { writeFileSync } from 'node:fs';

const cwd = mkdtempSync(join(tmpdir(), 'ch17-'));
const tools = createCodingTools(cwd);
const t0 = Date.now();
const timeline: string[] = [];
// 子 Agent 的脚本：第一轮跑一个耗时 0.4 秒的命令，第二轮汇报。从任务文字里取出编号
const childModel = scripted(c => {
  const task = (c.messages[0] as { content: string }).content;
  const id = task.match(/#(\d)/)![1];
  const done = c.messages.some(m => m.role === 'toolResult');
  if (!done) { timeline.push(`${((Date.now() - t0) / 1000).toFixed(1)}s 开始 #${id}`); return { toolCalls: [{ id: `s${id}`, name: 'bash', arguments: { command: 'sleep 0.4 && echo ok' } }] }; }
  timeline.push(`${((Date.now() - t0) / 1000).toFixed(1)}s 完成 #${id}`);
  return { text: `#${id} 完成` };
});
const tool = (hooks?: any, model = childModel) => createAgentTool({ model, tools: () => tools, agents: BUILTIN_AGENTS, cwd, maxConcurrency: 2, hooks });
const tasks = [1, 2, 3, 4].map(i => ({ agent: 'general', task: `子任务 #${i}` }));

console.log('━━ 4 个任务，最多同时 2 个 ━━');
const r = await tool().execute({ tasks }, { toolCallId: 'p' });
console.log(timeline.join('\n'));
console.log(`总耗时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒；交回的结果按任务顺序排列：${(r as any).details.map((d: any) => d.output).join('、')}`);

console.log('\n━━ 父 Agent 取消：子 Agent 一起停下 ━━');
const controller = new AbortController();
const slow = scripted(c => (c.messages.some(m => m.role === 'toolResult') ? { text: '完成' } : { toolCalls: [{ id: 'z', name: 'bash', arguments: { command: 'sleep 5' } }] }));
setTimeout(() => controller.abort(), 300);
const started = Date.now();
const aborted = await tool(undefined, slow).execute({ tasks: tasks.slice(0, 2) }, { toolCallId: 'p2', signal: controller.signal });
console.log(`${((Date.now() - started) / 1000).toFixed(1)} 秒后返回（命令本来要跑 5 秒）：${(aborted as any).details.map((d: any) => d.output).join('；')}`);

console.log('\n━━ 父 Agent 的权限规则对子 Agent 同样有效 ━━');
writeFileSync(join(cwd, 'permissions.json'), JSON.stringify({ permissions: { deny: ['Bash(rm *)'] } }));
const host = new ExtensionHost(cwd);
await host.load('permissions', createPermissionsMoxExtension([{ path: join(cwd, 'permissions.json'), base: cwd }], 'bypassPermissions'));
const rmModel = scripted(c => {
  const result = c.messages.find(m => m.role === 'toolResult');
  return result?.role === 'toolResult' ? { text: `rm 没能执行：${result.content}` } : { toolCalls: [{ id: 'rm', name: 'bash', arguments: { command: 'rm -rf build' } }] };
});
const denied = await tool(host.toolHooks(), rmModel).execute({ agent: 'general', task: '清理 build 目录' }, { toolCallId: 'p3' });
console.log(`子 Agent 汇报：${(denied as any).content}`);
