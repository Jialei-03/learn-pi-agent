// 第 4 章实验：执行前拦截、执行后改写。
//   node labs/ch04/hooks.ts
// 一个扩展注册 tool_call 和 tool_result 两个事件，cli.ts 把它们接到 runLoop 的 beforeTool / afterTool 上
// （接线方式和 mox/src/cli.ts 里的 beforeTool、afterTool 一样）。
//   tool_call：拦下会删除根目录的命令，工具函数根本不会被调用
//   tool_result：把命令输出里的密钥隐去，模型永远看不到原文
//   第三条命令换了个写法（find / -delete），正则拦不住
import assert from 'node:assert/strict';
import { loadExtensions, type Extension } from '../../mox/src/extensions.ts';
import { runMox, runPi, type RunTool } from '../shared/harness.ts';
import type { Script } from '../shared/scripted.ts';

const executed: string[] = [];
const bash: RunTool = {
  name: 'bash', description: '执行 shell 命令', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  run({ command }) {
    executed.push(command);                       // 假的 shell：只记录，不真正执行
    if (command === 'cat .env') return 'DATABASE_URL=postgres://localhost/mox\nOPENAI_API_KEY=sk-live-9f8e7d6c5b4a3210';
    return '（执行完成）';
  },
};

const guard: Extension = mox => {
  mox.on('tool_call', (name: string, args: any) =>
    name === 'bash' && /\brm\s+-rf\s+\/(\s|$)/.test(String(args.command)) ? '拒绝执行：这条命令会删除根目录。请只删除项目内的目录。' : undefined);
  mox.on('tool_result', (_name: string, _args: unknown, result: string) => {
    const redacted = result.replace(/sk-[A-Za-z0-9-]{8,}/g, 'sk-***');
    return redacted !== result ? redacted : undefined;
  });
};
const extensions = await loadExtensions([guard], { cwd: '/', tools: [], ask: async () => undefined });
// 接线方式和 mox/src/cli.ts 一样：tool_call 返回字符串 = 拒绝；返回 true = 放行（cli 里还会跳过向用户确认）；
// tool_result 是接力：每个扩展拿到上一个改过的结果，返回字符串就替换。
// 多个扩展时，tool_call 每个都会被问到、拒绝优先；tool_result 依次接力，都与“谁先加载”无关
const wire = (ext: Awaited<ReturnType<typeof loadExtensions>>) => ({
  beforeTool: async (name: string, args: unknown) => { const verdict = await ext.verdict(name, args); if (typeof verdict === 'string') return verdict; },
  afterTool: (name: string, args: unknown, result: string) => ext.transform(name, args, result),
});
const { beforeTool, afterTool } = wire(extensions);

const commands = ['rm -rf build && rm -rf /', 'cat .env', 'find / -delete'];
const script: Script = (_messages, n) => (n <= commands.length ? { toolCalls: [{ name: 'bash', arguments: { command: commands[n - 1] } }] } : { text: '处理完了。' });

for (const [label, run] of [['mox', runMox], ['Pi', runPi]] as const) {
  executed.length = 0;
  const report = await run({ prompt: '清理一下并看看配置', script, tools: [bash], beforeTool, afterTool });
  console.log(`━━ ${label} ━━`);
  report.results.forEach((r, i) => console.log(`第 ${i + 1} 条 ${commands[i].padEnd(26)} 模型看到：${r.content.replace(/\n/g, ' ⏎ ')}（${r.isError ? '错误' : '正常'}）`));
  console.log(`真正执行过的命令：${executed.join('；') || '（无）'}\n`);
  assert.deepEqual(executed, ['cat .env', 'find / -delete']);       // 第一条没有到达工具；换个写法的第三条到达了
  assert.ok(report.results[0].isError && report.results[1].content.includes('sk-***') && !report.results[1].content.includes('9f8e'));
}

// ── 两个扩展：拒绝优先，与加载顺序无关 ──
// 另一个扩展 allow 觉得“以 rm -rf build 开头的命令都是清理构建产物，放行”（返回 true）。
// 不管它排在 guard 前面还是后面加载，同一条命令都被 guard 拦下。只有 mox 一侧，Pi 的钩子语义不同。
const allow: Extension = mox => mox.on('tool_call', (_name: string, args: any) => (String(args.command).startsWith('rm -rf build') ? true : undefined));
console.log('━━ mox：两个扩展，拒绝优先 ━━');
console.log('| 加载顺序 | 第 1 条命令 `rm -rf build && rm -rf /` | 真正执行过的命令 |');
console.log('| --- | --- | --- |');
const outcome: Record<string, string> = {};
for (const [label, order] of [['guard，然后 allow', [guard, allow]], ['allow，然后 guard', [allow, guard]]] as const) {
  executed.length = 0;
  const ext = await loadExtensions([...order], { cwd: '/', tools: [], ask: async () => undefined });
  const report = await runMox({ prompt: '清理一下', script: (_m, n) => (n === 1 ? { toolCalls: [{ name: 'bash', arguments: { command: commands[0] } }] } : { text: '好了。' }), tools: [bash], ...wire(ext) });
  outcome[label] = report.results[0].isError ? '被拦下' : '放行了';
  console.log(`| ${label} | ${outcome[label]} | ${executed.join('；') || '（无）'} |`);
}
assert.equal(outcome['guard，然后 allow'], '被拦下');
assert.equal(outcome['allow，然后 guard'], '被拦下');                 // allow 先说“放行”，guard 仍然会被问到，拒绝优先

// ── tool_result 接力：两个扩展都改结果，谁先加载都不会让另一个失效 ──
// audit 在每条结果后面加一行“已审阅”；guard 里负责遮盖密钥的 tool_result 处理器仍在。
// 如果是“第一个返回字符串的说了算”，audit 排在前面时，遮盖密钥的处理器就根本不会运行，密钥原样交给模型。
const audit: Extension = mox => mox.on('tool_result', (_name: string, _args: unknown, result: string) => `${result}\n（已审阅）`);
console.log('\n━━ mox：tool_result 接力 ━━');
console.log('| 加载顺序 | `cat .env` 模型看到的结果 | 密钥泄露了吗 |');
console.log('| --- | --- | --- |');
for (const [label, order] of [['audit，然后 guard', [audit, guard]], ['guard，然后 audit', [guard, audit]]] as const) {
  const ext = await loadExtensions([...order], { cwd: '/', tools: [], ask: async () => undefined });
  const report = await runMox({ prompt: '看看配置', script: (_m, n) => (n === 1 ? { toolCalls: [{ name: 'bash', arguments: { command: 'cat .env' } }] } : { text: '好了。' }), tools: [bash], ...wire(ext) });
  const seen = report.results[0].content;
  console.log(`| ${label} | ${seen.replace(/\n/g, ' ⏎ ')} | ${seen.includes('9f8e') ? '泄露' : '没有'} |`);
  assert.ok(!seen.includes('9f8e') && seen.includes('sk-***') && seen.endsWith('（已审阅）'));   // 两个处理器都生效，顺序无关
}
