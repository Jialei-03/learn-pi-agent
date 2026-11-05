// 第 14 章实战检验：给 mox 加上权限。
//   node labs/ch14/practice.ts                      检验参考实现 mox/（和 extensions/permissions/mox.ts）
//   MOX_DIR=~/my-mox node labs/ch14/practice.ts     检验你自己的 mox（扩展放在 ~/my-mox/extensions/permissions.ts）
// 分五部分：cli.ts 的内置确认（启动真正的命令行）；权限扩展的三种情况；放行 vs 只能拒绝；拒绝优先；扩展接进真正的命令行。
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import { whose } from '../shared/mox-dir.ts';
import { scripted } from '../shared/scripted.ts';
import { callsInOrder, runCli } from './cli-run.ts';
import { assemble, describe, extFile } from './host.ts';

console.log(`${whose()}\n`);
const rules = { permissions: { deny: ['Read(.env)', 'Bash(rm *)'], allow: ['Bash(npm run *)'] } };
// 权限扩展从 ~/.mox/permissions.json 读规则：把 HOME 指到一个临时目录
const home = mkdtempSync(join(tmpdir(), 'ch14-home-'));
mkdirSync(join(home, '.mox'));
writeFileSync(join(home, '.mox', 'permissions.json'), JSON.stringify(rules));
process.env.HOME = home;

// ── 1. cli.ts 的内置确认：三种启动方式 ─────────────────────────────
console.log('## 1. cli.ts 的内置确认\n');
const builtinScript = callsInOrder([
  { name: 'read', arguments: { path: 'notes.txt' } },
  { name: 'write', arguments: { path: 'a.txt', content: 'a\n' } },
  { name: 'write', arguments: { path: 'b.txt', content: 'b\n' } },
  { name: 'bash', arguments: { command: 'ls' } },
]);
async function builtin(title: string, flags: string[], answers?: string[]) {
  const r = await runCli({ script: builtinScript, prompt: '按 notes.txt 干活', flags, answers, project: { 'notes.txt': '待办：写两个文件\n' } });
  console.log(`━━ ${title} ━━`);
  for (const o of r.outcomes) console.log(`${o.ok ? '✓' : '✗'} ${o.what.padEnd(14)} ${o.result.replace(/\s+/g, ' ').slice(0, 64)}`);
  console.log(`磁盘上：a.txt ${r.exists('a.txt') ? '有' : '没有'}，b.txt ${r.exists('b.txt') ? '有' : '没有'}\n`);
  return { ok: r.outcomes.map(o => o.ok), results: r.outcomes.map(o => o.result), files: [r.exists('a.txt'), r.exists('b.txt')] };
}
const quiet = await builtin('mox -p（没有终端）', []);
assert.deepEqual(quiet.ok, [true, false, false, false], '没有终端：read 放行，其余拒绝');
assert.ok(quiet.results[1].includes('没有终端可以确认') && quiet.results[1].includes('--yolo'));
assert.deepEqual(quiet.files, [false, false]);
const yolo = await builtin('mox -p --yolo', ['--yolo']);
assert.deepEqual(yolo.ok, [true, true, true, true]);
assert.deepEqual(yolo.files, [true, true]);
const talk = await builtin('mox（有终端）：2 = 本次会话都允许，3 = 拒绝', [], ['2', '3']);
assert.deepEqual(talk.ok, [true, true, true, false], '“本次会话都允许”记的是工具名：第二个 write 不再问，bash 要重新问');
assert.equal(talk.results[3], '错误：用户拒绝了这次调用');

// ── 2. 权限扩展：同一组命令，三种情况 ──────────────────────────────
console.log('## 2. 权限扩展：同一组命令，三种情况\n');
function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'ch14-'));
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src', 'app.ts'), 'export const port = 3000;\n');
  writeFileSync(join(cwd, '.env'), 'TOKEN=secret\n');
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'demo', scripts: { build: 'echo built' } }));
  writeFileSync(join(cwd, '.gitignore'), '.env\n');
  execSync('git init -q && git config user.email lab@example.com && git config user.name lab', { cwd });
  return cwd;
}
const calls = [
  { name: 'read', arguments: { path: 'src/app.ts' } },
  { name: 'bash', arguments: { command: 'npm run build' } },
  { name: 'bash', arguments: { command: 'git add -A && git commit -m "wip"' } },
  { name: 'edit', arguments: { path: 'src/app.ts', edits: [{ oldText: '3000', newText: '8080' }] } },
  { name: 'write', arguments: { path: 'src/util.ts', content: 'export {};\n' } },
  { name: 'bash', arguments: { command: 'cat .env' } },
  { name: 'bash', arguments: { command: `python3 -c "print(open('.env').read())"` } },
];
const model = () => scripted((_m, n) => (n <= calls.length ? { toolCalls: [calls[n - 1]] } : { text: '完成。' }));
/** 旧接口：tool_call 只能拒绝，返回 true 没有意义。把扩展的 true 吞掉，就是 mox 早先的行为 */
const onlyRefuse = (extension: (mox: ExtensionApi) => unknown) => (mox: ExtensionApi) =>
  extension({ ...mox, on: (event, handler) => mox.on(event, async (...args: unknown[]) => { const r = await handler(...args); return r === true ? undefined : r; }) });

async function session(answers: string[] | ((q: string, c: string[]) => string) | undefined, { plan = false, old = false } = {}) {
  const cwd = project();
  const extension = old ? onlyRefuse((await import(pathToFileURL(extFile('permissions')).href)).default) : extFile('permissions');
  const host = await assemble({ cwd, model: model(), sources: [extension], answers });
  if (plan) {                                   // /permissions 会打印当前规则，这里不需要
    const write = process.stdout.write;
    process.stdout.write = () => true;
    await host.command('/permissions plan');
    process.stdout.write = write;
  }
  await host.run('把端口改成 8080，加一个 util.ts，提交一下，顺便看看 .env 里配了什么');
  return host;
}
const interactive = await session(['允许一次', '本会话都允许', '拒绝']);
const headless = await session(undefined);
const planMode = await session([], { plan: true });
const mark = (h: typeof interactive) => h.steps.map(s => (s.error ? '✗' : '✓'));
console.log('| 调用 | 有终端 | 没有终端（-p） | 计划模式 |');
console.log('| --- | --- | --- | --- |');
calls.forEach((_, i) => {
  console.log(`| \`${describe(interactive.steps[i]).replace(/\|/g, '\\|').slice(0, 40)}\` | ${mark(interactive)[i]} | ${mark(headless)[i]} | ${mark(planMode)[i]} |`);
});
console.log(`\n有终端时弹出的确认框：\n${interactive.questions.map(q => `  ${q.question.slice(0, q.question.lastIndexOf('（')).slice(0, 60)} → 「${q.reply}」`).join('\n')}\n`);
assert.deepEqual(mark(interactive), ['✓', '✓', '✓', '✓', '✓', '✗', '✗']);
assert.deepEqual(interactive.questions.map(q => q.reply), ['允许一次', '本会话都允许', '拒绝'], '只问三次：git commit、edit、python；write 因为“本会话都允许”不再问');
assert.deepEqual(mark(headless), ['✓', '✓', '✗', '✗', '✗', '✗', '✗']);
assert.deepEqual(mark(planMode), ['✓', '✗', '✗', '✗', '✗', '✗', '✗']);
assert.equal(planMode.questions.length, 0, '计划模式：非只读的调用直接拒绝，不弹框');

// ── 3. 放行：规则允许的调用，不再被内置确认问第二遍 ─────────────────
console.log('## 3. 放行 vs 只能拒绝（每个问题都选第一项）\n');
const first = (_q: string, choices: string[]) => choices[0];
const before = await session(first, { old: true });
const after = await session(first);
const fromExtension = (h: typeof before) => h.questions.filter(q => q.question.startsWith('允许执行吗？')).length;
console.log(`| | 总提问 | 来自扩展 | 来自内置确认 |\n| --- | --- | --- | --- |`);
console.log(`| tool_call 只能拒绝 | ${before.questions.length} | ${fromExtension(before)} | ${before.questions.length - fromExtension(before)} |`);
console.log(`| tool_call 可以返回 true 放行 | ${after.questions.length} | ${fromExtension(after)} | ${after.questions.length - fromExtension(after)} |\n`);
assert.equal(before.questions.length - fromExtension(before), 5, '只能拒绝：规则允许的调用，内置确认还会再问');
assert.equal(after.questions.length - fromExtension(after), 0, '可以放行：内置确认让路');

// ── 4. 拒绝优先：放行的扩展盖不过别人的拒绝，和加载顺序无关 ───────────
console.log('## 4. 拒绝优先\n');
const allowAll = (mox: ExtensionApi) => mox.on('tool_call', () => true);
const denyWrite = (mox: ExtensionApi) => mox.on('tool_call', (name: string) => (name === 'write' ? '不许写' : undefined));
for (const [label, sources] of [['放行的在前', [allowAll, denyWrite]], ['放行的在后', [denyWrite, allowAll]]] as const) {
  const host = await assemble({ cwd: project(), sources: [...sources], model: scripted([{ toolCalls: [{ name: 'write', arguments: { path: 'x.txt', content: 'x' } }, { name: 'ls', arguments: {} }] }, { text: 'ok' }]), answers: undefined });
  await host.run('写个文件');
  console.log(`${label}：write ${host.steps[0].error ? '被拒绝' : '执行了'}（${host.steps[0].result.replace(/^错误：/, '')}），ls ${host.steps[1].error ? '被拒绝' : '放行'}`);
  assert.ok(host.steps[0].error && host.steps[0].result.includes('不许写'), `${label}：有一个扩展拒绝，调用就被拒绝`);
}

// ── 5. 接进真正的命令行 ──────────────────────────────────────────
console.log('\n## 5. 扩展接进真正的命令行（mox -e permissions，不加 --yolo）\n');
const cliScript = callsInOrder([
  { name: 'bash', arguments: { command: 'npm run build' } },
  { name: 'bash', arguments: { command: 'cat .env' } },
  { name: 'write', arguments: { path: 'util.ts', content: 'export {};\n' } },
  { name: 'bash', arguments: { command: `python3 -c "print(open('.env').read())"` } },
]);
const cliOptions = {
  script: cliScript, prompt: '构建，然后看看 .env', flags: ['-e', extFile('permissions')],
  project: { '.env': 'TOKEN=secret\n', 'package.json': JSON.stringify({ scripts: { build: 'echo built' } }) },
  home: { '.mox/permissions.json': JSON.stringify(rules) },
};
const show = (title: string, outcomes: { ok: boolean; what: string; result: string }[]) => {
  console.log(`━━ ${title} ━━`);
  for (const o of outcomes) console.log(`${o.ok ? '✓' : '✗'} ${o.what.slice(0, 44).padEnd(44)} ${o.result.replace(/\s+/g, ' ').replace(/^错误：/, '').slice(0, 50)}`);
  console.log();
};
const cliTalk = await runCli({ ...cliOptions, answers: ['2', '3'] });
show('有终端（两次提问，回答 2、3）', cliTalk.outcomes);
assert.deepEqual(cliTalk.outcomes.map(o => o.ok), [true, false, true, false]);
assert.ok(cliTalk.outcomes[1].result.includes('Read(.env)'));
const cliHeadless = await runCli(cliOptions);
show('-p（没有终端）', cliHeadless.outcomes);
assert.deepEqual(cliHeadless.outcomes.map(o => o.ok), [true, false, false, false]);
assert.ok(cliHeadless.outcomes[2].result.includes('当前没有终端可以确认'));
