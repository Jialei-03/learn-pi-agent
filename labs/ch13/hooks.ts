// 第 13 章实验：同一份 Claude Code 格式的钩子配置，分别装进 mox（extensions/hooks/mox.ts）和 Pi（extensions/hooks/index.ts）。
//   node labs/ch13/hooks.ts
// mox 这一侧是 loadExtensions + runLoop + 脚本模型，组装方式和 mox/src/cli.ts 一样；Pi 这一侧是真实的 AgentSession。
import assert from 'node:assert/strict';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createHooksExtension } from '../../extensions/hooks/index.ts';
import { createHooksMoxExtension } from '../../extensions/hooks/mox.ts';
import { loadExtensions } from '../../mox/src/extensions.ts';
import { runLoop } from '../../mox/src/loop.ts';
import type { Msg } from '../../mox/src/model.ts';
import { codingTools } from '../../mox/src/tools.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';
import { scripted } from '../shared/scripted.ts';
import { createProject, steps } from './fixture.ts';

const show = (s: string) => s.replace(/\n/g, ' ⏎ ').slice(0, 150);

// ── mox：同一份配置，同一个模型脚本 ──
const mox = createProject();
const notices: string[] = [];
const tools = codingTools(mox.cwd);
const extensions = await loadExtensions([createHooksMoxExtension([mox.hooksFile], t => notices.push(t))], { cwd: mox.cwd, tools, ask: async () => undefined });
const system = () => ['你是 mox。', ...extensions.prompts.map(part => part())].join('\n\n');       // 和 cli.ts 的 system() 一样
let n = 0;
const model = scripted(() => { const s = steps[n++]; return 'tool' in s ? { toolCalls: [{ id: `c${n - 1}`, name: s.tool, arguments: s.args }] } : { text: s.text }; });
const messages: Msg[] = [];
let text: string | undefined = '清理构建目录，部署到生产环境，再看看配置。';
while (text) {                                                                                     // 和 cli.ts 的 run() 一样：agent_end 返回字符串就续跑
  messages.push({ role: 'user', content: text });
  const final = await runLoop(messages, {
    model, system: system(), tools,
    beforeTool: async (name, args) => { const verdict = await extensions.verdict(name, args); return typeof verdict === 'string' ? verdict : undefined; },   // 和 cli.ts 一样：每个扩展都问一遍，字符串才是拒绝
    afterTool: (name, args, result) => extensions.transform(name, args, result),
  });
  text = await extensions.emit('agent_end', final);
}
await extensions.emit('shutdown');
console.log('━━ mox ━━');
console.log(`启动时：${notices.join('；')}`);
console.log(`系统提示里的 SessionStart 信息：${show(system().match(/<hook-context[\s\S]*?<\/hook-context>/)?.[0] ?? '（无）')}`);
const moxResults: string[] = [];
for (const m of messages) {
  if (m.role === 'assistant') {
    for (const c of m.tool_calls ?? []) console.log(`模型 → ${c.function.name} ${c.function.arguments}`);
    if (m.content) console.log(`模型：${m.content}`);
  }
  if (m.role === 'tool') { moxResults.push(m.content); console.log(`  ${m.content.startsWith('错误：') ? '✗' : '✓'} ${show(m.content.replace(/^错误：/, ''))}`); }
  if (m.role === 'user' && m.content.startsWith('Stop 钩子')) console.log(`  ↳ ${m.content}`);
}

// ── Pi ──
const pi = createProject();
let firstSystem = '';
const responses = steps.map((step, i) => (context: any) => {
  if (i === 0) firstSystem = context.messages.filter((m: any) => m.role === 'system').map((m: any) => Object.values(m.sections ?? {}).join('\n')).join('\n');
  return 'tool' in step
    ? fauxAssistantMessage(fauxToolCall(step.tool, step.args, { id: `c${i}` }), { stopReason: 'toolUse' })
    : fauxAssistantMessage(step.text);
});
const { session } = await createPiSession({ cwd: pi.cwd, responses, extensions: [createHooksExtension({ files: () => [pi.hooksFile] })] });
await session.prompt('清理构建目录，部署到生产环境，再看看配置。');
console.log('\n━━ Pi ━━');
console.log(`系统提示里的 SessionStart 信息：${show(firstSystem.match(/<hook-context[\s\S]*?<\/hook-context>/)?.[0] ?? '（无）')}`);
const piResults: string[] = [];
for (const m of session.messages as any[]) {
  if (m.role === 'assistant') for (const b of m.content) {
    if (b.type === 'toolCall') console.log(`模型 → ${b.name} ${JSON.stringify(b.arguments)}`);
    if (b.type === 'text' && b.text) console.log(`模型：${b.text}`);
  }
  if (m.role === 'toolResult') { piResults.push(textOf(m)); console.log(`  ${m.isError ? '✗' : '✓'} ${show(textOf(m))}`); }
  if (m.role === 'custom') console.log(`  ↳ ${textOf(m)}`);
}
const before = session.messages.length;
await session.prompt('我的密码是 hunter2，帮我登录服务器');
console.log(`\n用户：我的密码是 hunter2，帮我登录服务器`);
const piBlocked = session.messages.length === before;
console.log(`  ${piBlocked ? '提示被 UserPromptSubmit 钩子拦下，没有发给模型' : '提示发给了模型'}`);
session.dispose();

// ── 对照：哪些一样，哪些不一样 ──
const same = (a: string, b: string) => a.replace(/^错误：/, '').replace(/\s+/g, ' ').replace(/ ?\[退出码 0\]/, '').trim() === b.replace(/\s+/g, ' ').trim();
const labels = ['rm -rf build（PreToolUse 拦截）', './deploy.sh production（改写参数）', '读 .env（JSON 拒绝）', 'cat config.txt（PostToolUse 脱敏）', 'echo "12 passed"'];
console.log('\n━━ 同一份钩子配置，两个宿主 ━━\n');
console.log('| 工具调用 | mox 的结果 | 与 Pi 的结果 |');
console.log('| --- | --- | --- |');
moxResults.forEach((r, i) => console.log(`| ${labels[i]} | ${(show(r).length > 44 ? show(r).slice(0, 44) + '…' : show(r)).replace(/\|/g, '\\|')} | ${same(r, piResults[i] ?? '') ? '一致' : '措辞不同'} |`));
const stopped = messages.some(m => m.role === 'user' && m.content.startsWith('Stop 钩子'));
console.log(`\nStop 钩子要求继续：mox ${stopped ? '是' : '否'}；密码提示被拦下：mox 否（没有对应的事件，启动时已提示），Pi ${piBlocked ? '是' : '否'}`);

assert.equal(moxResults.length, 5);
assert.match(moxResults[0], /禁止执行破坏性命令/);
assert.match(moxResults[1], /--dry-run/);                      // 参数被改写，结果里能看到
assert.match(moxResults[1], /hook-context/);
assert.match(moxResults[2], /\.env/);
assert.match(moxResults[3], /\[REDACTED\]/);
assert.doesNotMatch(moxResults[3], /sk-live/);
assert.ok(stopped);
for (const i of [0, 2, 3]) assert.ok(same(moxResults[i], piResults[i]), `第 ${i + 1} 个结果与 Pi 一致`);
