// 第 13 章实验：一份 Claude Code 格式的钩子配置（labs/fixtures/hooks/ 下的七个脚本），装进 Pi（extensions/hooks/index.ts）。
//   node labs/ch13/hooks.ts
import assert from 'node:assert/strict';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createHooksExtension } from '../../extensions/hooks/index.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';
import { createProject, steps } from './fixture.ts';

const show = (s: string) => s.replace(/\n/g, ' ⏎ ').slice(0, 150);

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
console.log(`系统提示里的 SessionStart 信息：${show(firstSystem.match(/<hook-context[\s\S]*?<\/hook-context>/)?.[0] ?? '（无）')}`);
const results: string[] = [];
let continued = false;
for (const m of session.messages as any[]) {
  if (m.role === 'assistant') for (const b of m.content) {
    if (b.type === 'toolCall') console.log(`模型 → ${b.name} ${JSON.stringify(b.arguments)}`);
    if (b.type === 'text' && b.text) console.log(`模型：${b.text}`);
  }
  if (m.role === 'toolResult') { results.push(textOf(m)); console.log(`  ${m.isError ? '✗' : '✓'} ${show(textOf(m))}`); }
  if (m.role === 'custom') { continued = true; console.log(`  ↳ ${textOf(m)}`); }
}
const before = session.messages.length;
await session.prompt('我的密码是 hunter2，帮我登录服务器');
const blocked = session.messages.length === before;
console.log(`\n用户：我的密码是 hunter2，帮我登录服务器`);
console.log(`  ${blocked ? '提示被 UserPromptSubmit 钩子拦下，没有发给模型' : '提示发给了模型'}`);
session.dispose();

assert.match(firstSystem, /<hook-context event="SessionStart">/);
assert.match(results[0], /禁止执行破坏性命令/);
assert.match(results[1], /--dry-run/);
assert.match(results[2], /\.env/);
assert.match(results[3], /\[REDACTED\]/);
assert.doesNotMatch(results[3], /sk-live/);
assert.ok(continued, 'Stop 钩子让 Pi 再跑了一轮');
assert.ok(blocked);
