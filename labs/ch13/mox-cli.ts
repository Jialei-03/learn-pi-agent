// 第 13 章实验：真正的 mox 命令行加载 hooks 扩展：mox -e extensions/hooks/mox.ts
//   node labs/ch13/mox-cli.ts
// 钩子配置放在 ~/.mox/hooks.json（这里的 HOME 是临时目录），模型是本地假服务。
// 看五件事：SessionStart 的信息进了系统提示；rm -rf 被 PreToolUse 拦下；API Key 被 PostToolUse 脱敏；Stop 钩子让 Agent 继续；
// 不加 --yolo 时，钩子的 allow 决定（映射成 tool_call 返回 true）让调用跳过内置确认。
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runMox } from '../shared/mox-cli.ts';
import { createProject } from './fixture.ts';

const { cwd, hooksFile } = createProject();
const home = join(cwd, '.home');
mkdirSync(join(home, '.mox'), { recursive: true });
copyFileSync(hooksFile, join(home, '.mox', 'hooks.json'));

async function mox(prompt: string, flags: string[], script: Parameters<typeof runMox>[1]['script']) {
  const { code, output, requests } = await runMox(['-p', prompt, ...flags, '-e', join(import.meta.dirname, '../../extensions/hooks/mox.ts')], { cwd, home, script });
  assert.equal(code, 0, output);
  return { text: output, requests };
}

// ── 第一次：--yolo，看拦截、脱敏、SessionStart 和 Stop ──
const first = await mox('清理构建目录，再看看配置。', ['--yolo'], (_request, n) => [
  { toolCalls: [{ name: 'bash', arguments: { command: 'rm -rf build' } }, { name: 'bash', arguments: { command: 'cat config.txt' } }] },
  { text: '都处理好了。' },
  { toolCalls: [{ name: 'bash', arguments: { command: 'echo "12 passed"' } }] },
  { text: '测试通过（12 passed），全部完成。' },
][n - 1]);
console.log(first.text.trim());
console.log(`\n（启动时的提示：${first.text.split('\n').find(l => l.startsWith('[hooks]'))}）`);
assert.match(String(first.requests[0].messages[0].content), /<hook-context event="SessionStart">/);
assert.match(first.text, /✗ 错误：禁止执行破坏性命令/);
assert.match(first.text, /api_key=\[REDACTED\]/);
assert.doesNotMatch(first.text, /sk-live/);
assert.match(first.text, /↳ 扩展让 Agent 继续：Stop 钩子/);
assert.equal(first.requests.length, 4);

// ── 第二次：不加 --yolo，没有终端。PreToolUse 的 allow 决定被映射成 true，跳过 mox 内置的确认 ──
const second = await mox('部署，再看看目录。', [], (_request, n) => [
  { toolCalls: [{ name: 'bash', arguments: { command: './deploy.sh production' } }, { name: 'bash', arguments: { command: 'ls' } }] },
  { text: '好了，测试通过。' },
][n - 1]);
console.log('\n━━ 不加 --yolo：钩子的 allow 决定怎样影响内置确认 ━━');
console.log(second.text.trim().split('\n').filter(l => /^\s+[✓✗]|●/.test(l)).map(l => l.replace(/\s+/g, ' ')).join('\n'));
assert.match(second.text, /✓ deploy production --dry-run/);                       // dry-run-deploy.mjs 说了 allow：执行，而且不需要终端确认
assert.match(second.text, /✗ 错误：没有终端可以确认/);                             // ls 没有钩子给出结论：交给内置确认，被拒绝
