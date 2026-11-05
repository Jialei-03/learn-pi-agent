// 第 21 章实验：一次请求在 cli.ts 里的完整旅程。真正的 mox 命令行，加载两个扩展，带着项目说明和一个 Skill，让它修一个 bug。
//   node labs/ch21/journey.ts
// 模型是本机起的假服务器，按剧本说话；我们看它收到了什么、终端上发生了什么、会话文件里留下了什么。
// 剧本：派一个子 Agent 调研 → 想 rm -rf build（被扩展拦下）→ 改错了，没验证就说“修好了” → 目标循环发现检查没过，再来一轮 → 改对，测试通过。
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMox, type CliScript } from '../shared/mox-cli.ts';
import { whose } from '../shared/mox-dir.ts';
import { extFile } from '../ch18/ext.ts';

console.log(`${whose()}\n`);

const root = mkdtempSync(join(tmpdir(), 'ch21-'));
const cwd = join(root, 'project'), home = join(root, 'home');
mkdirSync(join(cwd, 'src'), { recursive: true });
mkdirSync(join(home, '.mox', 'skills', 'testing'), { recursive: true });
writeFileSync(join(cwd, 'package.json'), '{"type":"module"}');
writeFileSync(join(cwd, 'src', 'add.js'), 'export const add = (a, b) => a - b;\n');
writeFileSync(join(cwd, 'test.js'), "import { add } from './src/add.js';\nif (add(2, 3) !== 5) { console.error(`FAIL add(2, 3) = ${add(2, 3)}，期望 5`); process.exit(1); }\nconsole.log('PASS');\n");
writeFileSync(join(cwd, 'AGENTS.md'), '# 项目约定\n测试命令是 node test.js。\n');
writeFileSync(join(home, '.mox', 'skills', 'testing', 'SKILL.md'), '---\nname: testing\ndescription: 运行和修复这个项目的测试。改动代码后使用。\n---\n用 node test.js 运行测试。\n');
// 扩展一：团队规矩——拦下 rm，并往系统提示里加一句约定
writeFileSync(join(root, 'guard.ts'), "export default mox => {\n  mox.on('tool_call', (name, args) => (name === 'bash' && /\\brm\\b/.test(args.command) ? '不允许删除文件' : undefined));\n  mox.addSystemPrompt(() => '团队约定：不要删除文件。');\n};\n");
execSync('git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm init', { cwd });

const goalExtension = extFile('goal');
const firstUser = (messages: any[]) => messages.find(m => m.role === 'user').content as string;
const isChild = (messages: any[]) => firstUser(messages).startsWith('调研');

// 剧本按“这是主 Agent 的第几次请求”走；子 Agent 的请求单独数
let parentStep = 0, childStep = 0;
const script: CliScript = ({ messages }) => {
  if (isChild(messages)) {
    return ++childStep === 1 ? { toolCalls: [{ name: 'read', arguments: { path: 'src/add.js' } }] } : { text: 'add 在 src/add.js 第 1 行，用的是减号。' };
  }
  const edit = (oldText: string, newText: string) => ({ toolCalls: [{ name: 'edit', arguments: { path: 'src/add.js', edits: [{ oldText, newText }] } }] });
  const steps = [
    { toolCalls: [{ name: 'task', arguments: { prompt: '调研：add 函数在哪个文件，哪里错了？只要结论。' } }] },
    { toolCalls: [{ name: 'bash', arguments: { command: 'rm -rf build' } }] },
    edit('a - b', 'a * b'),                                              // 改错了
    { text: '修好了。' },                                                  // 没有验证就停下：目标循环会检查
    edit('a * b', 'a + b'),
    { toolCalls: [{ name: 'bash', arguments: { command: 'node test.js' } }] },
    { text: '修好了：减号改成加号，测试通过。' },
  ];
  return steps[parentStep++] ?? { text: '完成。' };
};

const run = await runMox(['-p', '修好 add 函数', '--yolo', '-e', join(root, 'guard.ts'), '-e', goalExtension], { cwd, home, script, env: { MOX_GOAL: 'node test.js' } });
assert.equal(run.code, 0, run.output);

// ① 第一次请求：系统提示由哪些部分拼成，工具有哪些
const first = run.requests[0];
const system = first.messages[0].content as string;
const has = (text: string) => (system.includes(text) ? '✓' : '✗');
console.log('① 第一次请求的系统提示（cli.ts 的 system()）：');
console.log(`   基本规则 ${has('你是 mox')}  项目说明 AGENTS.md ${has('测试命令是 node test.js')}  Skills 目录 ${has('testing：运行和修复')}  扩展用 addSystemPrompt 加的 ${has('团队约定：不要删除文件')}`);
console.log(`   工具定义（${first.tools!.length} 个）：${first.tools!.map(t => t.function.name).join('、')}`);

// ② 每次请求
console.log('\n② 模型收到的每一次请求（主 = 主 Agent，子 = task 里的子 Agent）：\n');
console.log('| # | 谁 | 消息数 | 触发这次请求的最后一条消息 |\n| --- | --- | --- | --- |');
run.requests.forEach((r, i) => {
  const last = r.messages.at(-1);
  const text = String(last.content).replace(/\s+/g, ' ');
  console.log(`| ${i + 1} | ${isChild(r.messages) ? '子' : '主'} | ${r.messages.length - 1} | ${last.role === 'tool' ? '工具结果' : '用户'}：${text.slice(0, 54)}${text.length > 54 ? '…' : ''} |`);
});

// ③ 终端上看到的（去掉颜色）：缩进的是子 Agent
console.log('\n③ 终端输出：');
for (const line of run.output.split('\n')) if (line.trim()) console.log(`   ${line.slice(0, 96)}`);

// ④ 会话文件：只有主 Agent 的消息
const sessionDir = join(home, '.mox', 'sessions'), dir = join(sessionDir, readdirSync(sessionDir)[0]);
const saved = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8').trim().split('\n').map(l => JSON.parse(l).message);
console.log(`\n④ 会话文件里有 ${saved.length} 条消息（子 Agent 的 ${run.requests.filter(r => isChild(r.messages)).length} 次请求不在里面）；add.js 最后是：${readFileSync(join(cwd, 'src', 'add.js'), 'utf8').trim()}`);

for (const part of ['你是 mox', '测试命令是 node test.js', 'testing：运行和修复', '团队约定：不要删除文件']) assert.ok(system.includes(part), `系统提示里应该有：${part}`);
assert.ok(first.tools!.some(t => t.function.name === 'task') && first.tools!.some(t => t.function.name === 'grep'));
assert.equal(run.requests.filter(r => isChild(r.messages)).length, 2);
assert.ok(!run.requests.filter(r => isChild(r.messages)).some(r => r.tools!.some(t => t.function.name === 'task')), '子 Agent 没有 task');
assert.match(run.output, /错误：不允许删除文件/);
assert.match(run.output, /扩展让 Agent 继续：目标还没有达成/);
assert.match(run.output, /目标达成/);
assert.match(readFileSync(join(cwd, 'src', 'add.js'), 'utf8'), /a \+ b/);
assert.ok(!saved.some(m => m.role === 'user' && String(m.content).startsWith('调研')), '子 Agent 的任务说明不在主会话里');
