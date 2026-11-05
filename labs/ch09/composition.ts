// 第 9 章实验：几个 Pi 扩展订阅同一个事件时，谁先谁后、谁说了算？出错了会怎样？
//   node labs/ch09/composition.ts
// 扩展 A：把命令里的 npm 改成 pnpm（就地修改参数）
// 扩展 B：拦下包含 publish 的命令（闸门）
// 扩展 C、D：依次改写工具结果（链式：D 看到的是 C 改过的结果）
// 扩展 E：处理 deploy 调用时自己抛了异常
// 扩展 F：在“运行结束”通知里抛了异常
import assert from 'node:assert/strict';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createPiSession, textOf } from '../shared/pi-session.ts';

const executed: string[] = [];
const calls = [
  { name: 'shell', arguments: { command: 'npm test' } },
  { name: 'shell', arguments: { command: 'npm publish' } },
  { name: 'deploy', arguments: {} },
];
const shellOutput = (command: string) => { executed.push(command); return `执行了：${command}\ntoken=ghp_abcdef123456`; };

const { session } = await createPiSession({
  responses: [fauxAssistantMessage(calls.map((c, i) => fauxToolCall(c.name, c.arguments, { id: `c${i}` })), { stopReason: 'toolUse' }), fauxAssistantMessage('处理完了。')],
  extensions: [
    (pi: any) => {
      pi.registerTool({ name: 'shell', label: 'shell', description: '执行命令', parameters: { type: 'object', properties: { command: { type: 'string' } } }, async execute(_i: string, p: any) { return { content: [{ type: 'text', text: shellOutput(p.command) }], details: {} }; } });
      pi.registerTool({ name: 'deploy', label: 'deploy', description: '部署', parameters: { type: 'object', properties: {} }, async execute() { executed.push('deploy'); return { content: [{ type: 'text', text: '已部署' }], details: {} }; } });
    },
    // #region extensions
    (pi: any) => pi.on('tool_call', (e: any) => { if (typeof e.input.command === 'string') e.input.command = e.input.command.replace(/\bnpm\b/, 'pnpm'); }),   // A：就地修改
    (pi: any) => pi.on('tool_call', (e: any) => (String(e.input.command ?? '').includes('publish') ? { block: true, reason: 'B：不允许发布' } : undefined)),   // B：闸门
    (pi: any) => pi.on('tool_result', (e: any) => ({ content: [{ type: 'text', text: textOf(e) + '\n（C 看过了）' }] })),                                   // C：链式
    (pi: any) => pi.on('tool_result', (e: any) => ({ content: [{ type: 'text', text: textOf(e).replace(/ghp_\w+/, 'ghp_***') }] })),                         // D：链式
    (pi: any) => pi.on('tool_call', (e: any) => { if (e.toolName === 'deploy') throw new Error('E 的代码有 bug'); }),                                     // E：闸门里抛异常
    (pi: any) => pi.on('agent_end', () => { throw new Error('F 的通知处理出错'); }),                                                                       // F：通知里抛异常
    // #endregion
  ],
});
await session.prompt('测试并发布');
const final = textOf(session.messages.at(-1));
const results = session.messages.filter((m: any) => m.role === 'toolResult').map((m: any) => ({ text: textOf(m), isError: !!m.isError }));
const recorded = session.messages.flatMap((m: any) => (m.role === 'assistant' ? m.content.filter((b: any) => b.type === 'toolCall').map((b: any) => JSON.stringify(b.arguments)) : []));
session.dispose();

console.log(`真正执行过的命令：${executed.join('；')}；会话里记录的第一个调用仍是 ${recorded[0]}`);
results.forEach((r, i) => console.log(`  ${calls[i].name} ${JSON.stringify(calls[i].arguments)} → ${r.isError ? '✗' : '✓'} ${r.text.replace(/\n/g, ' │ ')}`));
console.log(`\n最终回答：「${final}」——F 在运行结束的通知里抛了异常，运行照常结束`);

assert.deepEqual(executed, ['pnpm test']);                         // A 就地修改生效；B 拦下 publish；E 抛异常，deploy 没执行
assert.match(recorded[0], /npm test/);                             // 会话里记录的仍是模型发出的调用
assert.match(results[0].text, /ghp_\*\*\*.*C 看过了/s);             // 链式：D 看到 C 改过的结果，两个都生效
assert.deepEqual(results.map(r => r.isError), [false, true, true]);
assert.match(results[1].text, /B：不允许发布/);
assert.match(results[2].text, /E 的代码有 bug/);
assert.equal(final, '处理完了。');
