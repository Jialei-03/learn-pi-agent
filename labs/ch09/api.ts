// 第 9 章实验：扩展接口的五个注册入口分别做了什么？
//   node labs/ch09/api.ts
// 一个扩展同时用上 registerTool（新工具 + 同名替换 bash）、registerCommand、addSystemPrompt、ask，
// 然后直接用 loadExtensions 的返回值看每一个入口落在哪里。
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadExtensions, type Extension } from '../../mox/src/extensions.ts';
import { runLoop } from '../../mox/src/loop.ts';
import { codingTools } from '../../mox/src/tools.ts';
import { scripted } from '../shared/scripted.ts';

const cwd = mkdtempSync(join(tmpdir(), 'ch09-api-'));
const tools = codingTools(cwd);
const before = tools.map(t => t.name);
const asked: string[] = [];

// #region demo-extension
const demo: Extension = mox => {
  mox.registerTool({ name: 'now', description: '当前时间', parameters: { type: 'object', properties: {} }, run: () => '2026-11-05 12:00' });
  // 同名替换：拿到原来的 bash，包一层再注册回去
  const bash = codingTools(mox.cwd).find(t => t.name === 'bash')!;
  mox.registerTool({ ...bash, run: async (args, signal) => `（经过扩展的 bash）\n${await bash.run(args, signal)}` });
  mox.registerCommand('hello', name => `你好，${name || '世界'}`);
  let runs = 0;
  mox.addSystemPrompt(() => `这是第 ${++runs} 次取值`);
  mox.registerCommand('danger', async () => (await mox.ask('确定要清空吗？', ['确定', '取消'])) ?? '没有终端，没人回答');
};
// #endregion

// #region gate
// Pi 的 permission-gate 示例，写成 mox 扩展：危险命令先问用户，没有终端（ask 返回 undefined）就拒绝
const gate: Extension = mox => mox.on('tool_call', async (name, args) => {
  if (name !== 'bash' || !/\brm\s+-rf\b|\bsudo\b/.test(args.command)) return;
  const choice = await mox.ask(`允许危险命令吗？${args.command}`, ['允许', '拒绝']);
  if (choice !== '允许') return '用户没有批准这条危险命令';
});
// #endregion

const extensions = await loadExtensions([demo, gate], { cwd, tools, ask: async (question, choices) => { asked.push(`${question} [${choices.join('/')}]`); return choices[1]; } });
const after = tools.map(t => t.name);

console.log(`工具：${before.join('、')}\n  → 加载扩展之后：${after.join('、')}（bash 只有一个，位置没变，函数被换成了扩展注册的那个）`);
const model = scripted([{ toolCalls: [{ name: 'bash', arguments: { command: 'echo hi' } }, { name: 'now', arguments: {} }] }, { text: '好了。' }]);
const messages: Parameters<typeof runLoop>[0] = [{ role: 'user', content: '试试' }];
await runLoop(messages, { model, system: '', tools });
for (const m of messages) if (m.role === 'tool') console.log(`  工具结果：${m.content.replace(/\n/g, ' ⏎ ')}`);
console.log(`命令：/hello 小明 → ${await extensions.commands.get('hello')!('小明')}`);
console.log(`命令里用 ask：/danger → ${await extensions.commands.get('danger')!('')}（宿主收到的问题：${asked[0]}）`);
console.log(`系统提示片段（每调用一次就重新取值）：${extensions.prompts[0]()} / ${extensions.prompts[0]()}`);

const dangerous = await extensions.verdict('bash', { command: 'rm -rf build' });
const harmless = await extensions.verdict('bash', { command: 'ls' });
console.log(`gate 扩展：rm -rf build → ${dangerous}（宿主收到的问题：${asked.at(-1)}）；ls → ${harmless ?? '放行'}`);
assert.equal(dangerous, '用户没有批准这条危险命令');
assert.equal(harmless, undefined);

assert.deepEqual(after, [...before, 'now']);
assert.equal(after.filter(n => n === 'bash').length, 1);
assert.ok(messages.some(m => m.role === 'tool' && m.content.startsWith('（经过扩展的 bash）')));
assert.equal(extensions.prompts.length, 1);
