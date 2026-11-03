// 第 9 章实验：几个扩展订阅同一个事件时，谁先谁后、谁说了算？出错了会怎样？
//   node labs/ch09/composition.ts
// 扩展 A：把命令里的 npm 改成 pnpm（就地修改参数）
// 扩展 B：拦下包含 publish 的命令（闸门）
// 扩展 C、D：依次改写工具结果（链式：D 看到的是 C 改过的结果）
// 扩展 E：处理 deploy 调用时自己抛了异常
// 扩展 F：在“运行结束”通知里抛了异常
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { ExtensionHost } from '../../mox/src/extensions.ts';
import { runLoop } from '../../mox/src/loop.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import type { AgentTool } from '../../mox/src/tools.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';

const executed: string[] = [];
const calls = [
  { name: 'shell', arguments: { command: 'npm test' } },
  { name: 'shell', arguments: { command: 'npm publish' } },
  { name: 'deploy', arguments: {} },
];
const shellOutput = (command: string) => { executed.push(command); return `执行了：${command}\ntoken=ghp_abcdef123456`; };

// ── 同一组扩展，分别写成 mox 和 Pi 的形式 ─────────────────
const moxTools: AgentTool[] = [
  { name: 'shell', description: '执行命令', parameters: { type: 'object', properties: { command: { type: 'string' } } }, execute: ({ command }) => shellOutput(command) },
  { name: 'deploy', description: '部署', parameters: { type: 'object', properties: {} }, execute: () => { executed.push('deploy'); return '已部署'; } },
];
const host = new ExtensionHost('/tmp');
await host.load('A', api => api.on('tool_call', e => { if (typeof e.input.command === 'string') e.input.command = e.input.command.replace(/\bnpm\b/, 'pnpm'); }));
await host.load('B', api => api.on('tool_call', e => (String(e.input.command ?? '').includes('publish') ? { block: true, reason: 'B：不允许发布' } : undefined)));
await host.load('C', api => api.on('tool_result', e => ({ content: e.result.content + '\n（C 看过了）' })));
await host.load('D', api => api.on('tool_result', e => ({ content: e.result.content.replace(/ghp_\w+/, 'ghp_***') })));
await host.load('E', api => api.on('tool_call', e => { if (e.toolName === 'deploy') throw new Error('E 的代码有 bug'); }));
await host.load('F', api => api.on('agent_end', () => { throw new Error('F 的通知处理出错'); }));

const { messages } = await runLoop([], [{ role: 'user', content: '测试并发布' }], {
  model: scripted((_c, n) => (n === 1 ? { toolCalls: calls } : { text: '处理完了。' })),
  systemPrompt: '', tools: [...moxTools, ...host.tools], hooks: host.toolHooks(),
});
await host.notify('agent_end', { reason: 'done' });
const moxResults = messages.filter(m => m.role === 'toolResult').map(m => ({ text: (m as any).content as string, isError: (m as any).isError as boolean }));
const moxExecuted = [...executed];
const moxFinal = (messages.at(-1) as any)?.content?.[0]?.text;

executed.length = 0;
const piErrors: string[] = [];
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
    (pi: any) => pi.on('agent_end', () => { throw new Error('F 的通知处理出错'); }),
  ],
});
session.subscribe?.((e: any) => { if (e.type === 'extension_error') piErrors.push(e.error); });
await session.prompt('测试并发布');
const piFinal = textOf(session.messages.at(-1));
const piResults = session.messages.filter((m: any) => m.role === 'toolResult').map((m: any) => ({ text: textOf(m), isError: m.isError }));
session.dispose();

for (const [label, results, ran] of [['mox', moxResults, moxExecuted], ['Pi', piResults, executed]] as const) {
  console.log(`━━ ${label} ━━`);
  console.log(`真正执行过的命令：${ran.join('；')}`);
  results.forEach((r, i) => console.log(`  ${calls[i].name} ${JSON.stringify(calls[i].arguments)} → ${r.isError ? '✗' : '✓'} ${r.text.replace(/\n/g, ' │ ')}`));
}
console.log(`\nmox 记录的扩展错误：${host.errors.map(e => `${e.extension}/${e.event}：${e.message}`).join('；')}`);
console.log(`最终回答：mox「${moxFinal}」，Pi「${piFinal}」——运行没有因为 F 的错误而中断`);
