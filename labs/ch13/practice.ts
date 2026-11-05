// 第 13 章实战检验：给 mox 写的钩子扩展（extensions/hooks/mox.ts），跑在你的 extensions.ts、loop.ts 和 tools.ts 上。
// 钩子配置和脚本就是上面 Pi 实验用的那一份。
//   node labs/ch13/practice.ts                          检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch13/practice.ts         检验你自己的 mox
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHooksMoxExtension } from '../../extensions/hooks/mox.ts';
import { loadMox, whose } from '../shared/mox-dir.ts';
import { scripted } from '../shared/scripted.ts';
import { createProject, steps } from './fixture.ts';

const { loadExtensions } = await loadMox('extensions.ts');
const { runLoop } = await loadMox('loop.ts');
const { codingTools } = await loadMox('tools.ts');

console.log(whose());
console.log();

// ── 把完整的一次运行装配起来（和 cli.ts 一样：verdict / transform / agent_end 续跑）──
const project = createProject();
const notices: string[] = [];
const tools = codingTools(project.cwd);
const asked: string[] = [];
const ext = await loadExtensions([createHooksMoxExtension([project.hooksFile], (t: string) => notices.push(t))], {
  cwd: project.cwd, tools, ask: async (q: string) => { asked.push(q); return undefined; },
});
const system = ['你是 mox。', ...ext.prompts.map((p: () => string) => p())].join('\n\n');
let n = 0;
const model = scripted(() => { const s = steps[n++]; return 'tool' in s ? { toolCalls: [{ id: `c${n - 1}`, name: s.tool, arguments: s.args }] } : { text: s.text }; });
const messages: any[] = [];
let text: string | undefined = '清理构建目录，部署到生产环境，再看看配置。';
const verdicts: unknown[] = [];
while (text) {
  messages.push({ role: 'user', content: text });
  const final = await runLoop(messages, {
    model, system, tools,
    beforeTool: async (name: string, args: unknown) => { const v = await ext.verdict(name, args); verdicts.push(v); return typeof v === 'string' ? v : undefined; },
    afterTool: (name: string, args: unknown, result: string) => ext.transform(name, args, result),
  });
  text = ext.text(await ext.emit('agent_end', final));
}
await ext.emit('shutdown');
const results = messages.filter(m => m.role === 'tool').map(m => m.content as string);

const rows: [string, string][] = [];
function check(name: string, run: () => string) {
  try { rows.push([name, `通过：${run()}`]); } catch (e) { rows.push([name, `**失败**：${(e as Error).message.split('\n')[0]}`]); process.exitCode = 1; }
}

check('SessionStart：钩子的信息进了系统提示（addSystemPrompt）', () => {
  assert.match(system, /<hook-context event="SessionStart">[\s\S]*部署脚本是 \.\/deploy\.sh/);
  return '系统提示里有 <hook-context event="SessionStart">';
});
check('PreToolUse 拒绝：rm -rf build 被拦下（退出码 2）', () => {
  assert.match(results[0], /^错误：禁止执行破坏性命令/);
  return results[0].slice(0, 30);
});
check('PreToolUse 改写 + allow：./deploy.sh 被加上 --dry-run，verdict 为 true', () => {
  assert.match(results[1], /deploy production --dry-run/);
  assert.equal(verdicts[1], true);
  assert.match(results[1], /<hook-context event="PostToolUse">[\s\S]*dry-run/);
  assert.equal(messages.flatMap(m => m.tool_calls ?? []).find((c: any) => c.function.arguments.includes('deploy.sh')).function.arguments.includes('dry-run'), false);
  return '实际执行带 --dry-run；会话里记录的仍是模型发出的原调用；补充信息附在结果末尾';
});
check('PreToolUse JSON 拒绝：读 .env', () => {
  assert.match(results[2], /^错误：\.env 里是密钥/);
  return results[2].slice(0, 30);
});
check('PostToolUse：API Key 在交给模型之前被遮盖', () => {
  assert.match(results[3], /api_key=\[REDACTED\]/);
  assert.doesNotMatch(results[3], /sk-live/);
  return results[3].replace(/\s+/g, ' ');
});
check('Stop（agent_end）：没提测试，钩子让 Agent 接着干；第二次放行', () => {
  const resumed = messages.filter(m => m.role === 'user' && m.content.startsWith('Stop 钩子'));
  assert.equal(resumed.length, 1);
  assert.match(messages.at(-1).content, /测试通过/);
  return resumed[0].content;
});
check('UserPromptSubmit：mox 对应不上，启动时提示', () => {
  assert.ok(notices.some(t => t.includes('UserPromptSubmit')));
  return notices.find(t => t.includes('UserPromptSubmit'))!;
});
// PostToolUse 只在工具成功时触发：mox 的 bash 在退出码非零时抛错，错误结果不经过 afterTool
{
  const dir = mkdtempSync(join(tmpdir(), 'ch13-post-'));
  const log = join(dir, 'post.log');
  writeFileSync(join(dir, 'post.mjs'), `import {appendFileSync} from 'node:fs'; let raw='';for await (const c of process.stdin) raw+=c; appendFileSync(${JSON.stringify(log)}, JSON.parse(raw).tool_input.command+'\\n');`);
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `node ${join(dir, 'post.mjs')}` }] }] } }));
  const t2 = codingTools(dir);
  const e2 = await loadExtensions([createHooksMoxExtension([join(dir, 'hooks.json')], () => {})], { cwd: dir, tools: t2, ask: async () => undefined });
  await runLoop([{ role: 'user', content: 'x' }], {
    model: scripted([{ toolCalls: [{ name: 'bash', arguments: { command: 'echo ok' } }] }, { toolCalls: [{ name: 'bash', arguments: { command: 'exit 3' } }] }, { text: '好。' }]), system: '', tools: t2,
    beforeTool: async (name: string, args: unknown) => { const v = await e2.verdict(name, args); return typeof v === 'string' ? v : undefined; },
    afterTool: (name: string, args: unknown, result: string) => e2.transform(name, args, result),
  });
  const logged = readFileSync(log, 'utf8').trim().split('\n');
  try { assert.deepEqual(logged, ['echo ok']); rows.push(['PostToolUse 只在成功时触发：失败的命令（退出码非零）不触发', `通过：日志里只有 ${logged.join('、')}`]); }
  catch (e) { rows.push(['PostToolUse 只在成功时触发', `**失败**：${(e as Error).message.split('\n')[0]}`]); process.exitCode = 1; }
}

console.log('| 检查 | 结果 |');
console.log('| --- | --- |');
for (const [name, result] of rows) console.log(`| ${name} | ${result.replace(/\|/g, '\\|')} |`);
