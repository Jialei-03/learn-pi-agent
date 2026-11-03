// 第 13 章实验：同一份 Claude Code 格式的钩子配置，分别装进 Pi（extensions/hooks）和 mox（extensions/hooks/mox.ts）。
//   node labs/ch13/hooks.ts
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createHooksExtension } from '../../extensions/hooks/index.ts';
import { createHooksMoxExtension } from '../../extensions/hooks/mox.ts';
import { createCodingTools } from '../../mox/src/coding/index.ts';
import { ExtensionHost } from '../../mox/src/extensions.ts';
import { runLoop } from '../../mox/src/loop.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import type { Message } from '../../mox/src/types.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';
import { createProject, steps } from './fixture.ts';

const show = (s: string) => s.replace(/\n/g, ' ⏎ ').slice(0, 150);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();   // bash 输出末尾的空行两边略有不同，比较时忽略空白

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
console.log('━━ Pi ━━');
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
console.log(`  ${session.messages.length === before ? '提示被 UserPromptSubmit 钩子拦下，没有发给模型' : '提示发给了模型'}`);
session.dispose();

// ── mox：同一份配置，同一个模型脚本 ──
const mox = createProject();
const host = new ExtensionHost(mox.cwd);
const notices: string[] = [];
await host.load('hooks', createHooksMoxExtension([mox.hooksFile], t => notices.push(t)));
await host.notify('session_start', { cwd: mox.cwd });
const tools = createCodingTools(mox.cwd);
let n = 0;
const model = scripted(() => { const s = steps[n++]; return 'tool' in s ? { toolCalls: [{ id: `c${n - 1}`, name: s.tool, arguments: s.args }] } : { text: s.text }; });
const history: Message[] = [];
const messagesSoFar: Message[] = [];
const input = await host.emitInput('清理构建目录，部署到生产环境，再看看配置。');
const systemPrompt = await host.emitBeforeAgentStart(input.text, '你是 mox。');
const { messages } = await runLoop(history, [{ role: 'user', content: input.text }], {
  model, systemPrompt, tools, hooks: host.toolHooks(),
  getFollowUp: async () => { const t = await host.emitBeforeSettle([...history, ...messagesSoFar]); return t ? [{ role: 'user', content: t }] : []; },
  onEvent: e => { if (e.type === 'message') messagesSoFar.push(e.message); },
});
const moxResults = messages.filter(m => m.role === 'toolResult').map(m => (m.role === 'toolResult' ? m.content : ''));
const blocked = await host.emitInput('我的密码是 hunter2，帮我登录服务器');
await host.notify('session_shutdown', {});

console.log('\n━━ mox：同一份钩子配置 ━━');
moxResults.forEach((r, i) => console.log(`  第 ${i + 1} 个工具结果：${norm(r) === norm(piResults[i] ?? '') ? '与 Pi 一致' : `不同 —— ${show(r)}`}`));
console.log(`  Stop 钩子要求继续：${messages.some(m => m.role === 'user' && m.content.startsWith('Stop 钩子')) ? '是' : '否'}；密码提示被拦下：${blocked.handled ? '是' : '否'}`);
