// 第 9 章实验：几个扩展订阅同一个事件时，谁先谁后、谁说了算？
//   node labs/ch09/composition.ts
// 扩展 A：把命令里的 npm 改成 pnpm（就地修改参数）
// 扩展 B：拦下包含 publish 的命令（闸门）
// 扩展 C：在工具结果末尾加一句"C 看过了"
// 扩展 D：把结果里的令牌 ghp_… 隐去
// 扩展 E：处理 deploy 调用时自己抛了异常
// 同一组扩展、同一个模型脚本，分别交给 Pi 和 mox（mox 跑两遍：C 先加载，和 D 先加载，结果一样）。
import assert from 'node:assert/strict';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { loadExtensions, type Extension } from '../../mox/src/extensions.ts';
import { runLoop, type Tool } from '../../mox/src/loop.ts';
import { scripted } from '../shared/scripted.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';

const calls = [
  { name: 'shell', arguments: { command: 'npm test' } },
  { name: 'shell', arguments: { command: 'npm publish' } },
  { name: 'deploy', arguments: {} },
];
type Outcome = { text: string; isError: boolean };

// ── mox ─────────────────────────────────────────────
// #region mox-extensions
const A: Extension = mox => mox.on('tool_call', (_name, args) => { if (typeof args.command === 'string') args.command = args.command.replace(/\bnpm\b/, 'pnpm'); });
const B: Extension = mox => mox.on('tool_call', (_name, args) => (String(args.command ?? '').includes('publish') ? 'B：不允许发布' : undefined));
const C: Extension = mox => mox.on('tool_result', (_name, _args, result) => `${result}\n（C 看过了）`);
const D: Extension = mox => mox.on('tool_result', (_name, _args, result) => result.replace(/ghp_\w+/, 'ghp_***'));
const E: Extension = mox => mox.on('tool_call', name => { if (name === 'deploy') throw new Error('E 的代码有 bug'); });
// #endregion

async function runMox(sources: Extension[]) {
  const executed: string[] = [];
  const tools: Tool[] = [
    { name: 'shell', description: '执行命令', parameters: { type: 'object', properties: { command: { type: 'string' } } }, run: ({ command }) => { executed.push(command); return `执行了：${command}\ntoken=ghp_abcdef123456`; } },
    { name: 'deploy', description: '部署', parameters: { type: 'object', properties: {} }, run: () => { executed.push('deploy'); return '已部署'; } },
  ];
  const extensions = await loadExtensions(sources, { cwd: '/tmp', tools, ask: async () => undefined });
  const messages: Parameters<typeof runLoop>[0] = [{ role: 'user', content: '测试并发布' }];
  await runLoop(messages, {
    model: scripted((_m, n) => (n === 1 ? { toolCalls: calls } : { text: '处理完了。' })), system: '', tools,
    beforeTool: async (name, args) => { const verdict = await extensions.verdict(name, args); return typeof verdict === 'string' ? verdict : undefined; },   // 和 cli.ts 一样：每个扩展都问一遍，字符串才是拒绝
    afterTool: (name, args, result) => extensions.transform(name, args, result),
  });
  const results: Outcome[] = messages.flatMap(m => (m.role === 'tool' ? [{ text: m.content, isError: m.content.startsWith('错误：') }] : []));
  const recorded = messages.flatMap(m => (m.role === 'assistant' ? (m.tool_calls ?? []).map(c => c.function.arguments) : []));
  return { results, executed, recorded };
}

// ── Pi ──────────────────────────────────────────────
async function runPi() {
  const executed: string[] = [];
  const shellOutput = (command: string) => { executed.push(command); return `执行了：${command}\ntoken=ghp_abcdef123456`; };
  const { session } = await createPiSession({
    responses: [fauxAssistantMessage(calls.map((c, i) => fauxToolCall(c.name, c.arguments, { id: `c${i}` })), { stopReason: 'toolUse' }), fauxAssistantMessage('处理完了。')],
    extensions: [
      (pi: any) => {
        pi.registerTool({ name: 'shell', label: 'shell', description: '执行命令', parameters: { type: 'object', properties: { command: { type: 'string' } } }, async execute(_i: string, p: any) { return { content: [{ type: 'text', text: shellOutput(p.command) }], details: {} }; } });
        pi.registerTool({ name: 'deploy', label: 'deploy', description: '部署', parameters: { type: 'object', properties: {} }, async execute() { executed.push('deploy'); return { content: [{ type: 'text', text: '已部署' }], details: {} }; } });
      },
      (pi: any) => pi.on('tool_call', (e: any) => { if (typeof e.input.command === 'string') e.input.command = e.input.command.replace(/\bnpm\b/, 'pnpm'); }),
      (pi: any) => pi.on('tool_call', (e: any) => (String(e.input.command ?? '').includes('publish') ? { block: true, reason: 'B：不允许发布' } : undefined)),
      (pi: any) => pi.on('tool_result', (e: any) => ({ content: [{ type: 'text', text: textOf(e) + '\n（C 看过了）' }] })),
      (pi: any) => pi.on('tool_result', (e: any) => ({ content: [{ type: 'text', text: textOf(e).replace(/ghp_\w+/, 'ghp_***') }] })),
      (pi: any) => pi.on('tool_call', (e: any) => { if (e.toolName === 'deploy') throw new Error('E 的代码有 bug'); }),
    ],
  });
  await session.prompt('测试并发布');
  const results: Outcome[] = session.messages.filter((m: any) => m.role === 'toolResult').map((m: any) => ({ text: textOf(m), isError: !!m.isError }));
  session.dispose();
  return { results, executed };
}

const runs = { 'Pi': await runPi(), 'mox（C 先加载）': await runMox([A, B, C, D, E]), 'mox（D 先加载）': await runMox([A, B, D, C, E]) };
const show = (r: Outcome) => `${r.isError ? '✗' : '✓'} ${r.text.replace(/\n/g, ' ⏎ ')}`;

for (const [label, run] of Object.entries(runs)) console.log(`${label}：真正执行的命令是 ${run.executed.join('；')}${'recorded' in run ? `；会话里记录的第一个调用仍是 ${run.recorded[0]}` : ''}`);
console.log();
console.log('| 模型的调用 | ' + Object.keys(runs).join(' | ') + ' |');
console.log('| --- | --- | --- | --- |');
calls.forEach((c, i) => console.log(`| \`${c.name} ${JSON.stringify(c.arguments)}\` | ${Object.values(runs).map(run => show(run.results[i]).replace(/\|/g, '\\|')).join(' | ')} |`));

const [pi, moxC, moxD] = Object.values(runs);
assert.deepEqual(pi.executed, ['pnpm test']);                                    // 就地修改生效，publish 被拦下，deploy 没执行
assert.deepEqual(moxC.executed, ['pnpm test']);
assert.match(moxC.recorded[0], /npm test/);                                        // 改的是解析出来的参数对象，会话里模型的调用原样保留
assert.match(pi.results[0].text, /ghp_\*\*\*.*C 看过了/s);                       // Pi 链式：D 看到 C 改过的结果，两个都生效
// mox 的 tool_result 也是接力（extensions.transform）：D 看到 C 改过的结果，令牌被遮盖，C 的话也保留；谁先加载都一样
assert.equal(moxC.results[0].text, pi.results[0].text);
assert.equal(moxD.results[0].text, pi.results[0].text);
assert.match(moxC.results[0].text, /ghp_\*\*\*.*C 看过了/s);
for (const run of Object.values(runs)) {
  assert.deepEqual(run.results.map(r => r.isError), [false, true, true]);        // publish 被拦、deploy 因为 E 抛异常而没执行
  assert.match(run.results[1].text, /B：不允许发布/);
  assert.match(run.results[2].text, /E 的代码有 bug/);
}
