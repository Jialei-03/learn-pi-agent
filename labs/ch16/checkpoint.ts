// 第 16 章实验：检查点与 /rewind。两次提问改了文件（用 edit 工具、用 bash、新建文件），再回到第一次提问之前。
//   node labs/ch16/checkpoint.ts
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createCheckpointExtension } from '../../extensions/checkpoint/index.ts';
import { createPiSession } from '../shared/pi-session.ts';

function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'ch16-'));
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src', 'cli.ts'), "if (command === 'add') add();\n");
  writeFileSync(join(cwd, 'README.md'), '# mox notes\n');
  execSync('git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm init', { cwd });
  return cwd;
}
const files = (cwd: string) => ['src/cli.ts', 'src/list.ts', 'README.md'].map(f => `${f}：${existsSync(join(cwd, f)) ? JSON.stringify(readFileSync(join(cwd, f), 'utf8').trim()) : '（不存在）'}`).join('\n    ');
const call = (name: string, args: object, id: string) => fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: 'toolUse' });

const cwd = project();
const answers = ['1. 加一个 list 命令', '代码和对话'];
const notices: string[] = [];
const { session } = await createPiSession({
  cwd,
  ui: { select: async (_t: string, options: string[]) => options.find(o => o === answers[0] || o.startsWith(answers[0])) && answers.shift(), notify: (m: string) => notices.push(m) },
  extensions: [createCheckpointExtension({ storeDir: () => join(cwd, '..', `${cwd.split('/').pop()}-shadow.git`) })],
  responses: [
    call('edit', { path: 'src/cli.ts', edits: [{ oldText: "add();", newText: "add();\nelse if (command === 'list') list();" }] }, 'e1'),
    call('bash', { command: "echo '用法：mox list' >> README.md" }, 'b1'),
    call('bash', { command: "printf 'export function list() {}\\n' > src/list.ts" }, 'b2'),
    fauxAssistantMessage('加好了。'),
    call('bash', { command: 'rm README.md' }, 'b3'),
    fauxAssistantMessage('删掉了。'),
  ],
});
const original = files(cwd);
console.log(`开始时：\n    ${original}\n`);
await session.prompt('加一个 list 命令');
await session.prompt('README 没用了，删掉');
console.log(`两次提问之后（对话里有 ${session.messages.length} 条消息）：\n    ${files(cwd)}\n`);
assert.notEqual(files(cwd), original, '两次提问之后，文件应该已经被改过');
assert.equal(session.messages.length, 13);
await session.prompt('/rewind');
console.log(`/rewind → 选第 1 个检查点 → 代码和对话：\n    ${files(cwd)}`);
console.log(`  对话里还剩 ${session.messages.length} 条消息；提示：${notices.at(-1)?.replace('：\n', '：').replace(/\n/g, '；')}`);
console.log(`  恢复的内容由 edit 工具、bash 和新建文件造成，全部回到了原样。`);
// 正文的结论：edit 改的、bash 追加的、新建的文件和一次删除全部回到原样，对话回到第一次提问之前
assert.equal(files(cwd), original);
assert.equal(session.messages.length, 0);
for (const line of ['恢复 README.md', '还原 src/cli.ts', '删除 src/list.ts']) assert.ok(notices.at(-1)!.includes(line), `恢复提示里应该有“${line}”`);
session.dispose();

// 对照：Pi 官方 git-checkpoint 示例用的 git stash create
const other = project();
const ref = execSync('git stash create', { cwd: other, encoding: 'utf8' }).trim();
assert.equal(ref, '', '干净的工作区里 git stash create 什么都不返回');
console.log(`\n对照：在同样干净的工作区里运行 git stash create，返回值是 ${ref ? ref : '空的'}——工作区没有改动时它不创建任何东西，第一轮就没有检查点。`);
writeFileSync(join(other, 'src', 'list.ts'), 'export function list() {}\n');
writeFileSync(join(other, 'README.md'), '# changed\n');
const ref2 = execSync('git stash create', { cwd: other, encoding: 'utf8' }).trim();
const inStash = execSync(`git show --name-only --format= ${ref2}`, { cwd: other, encoding: 'utf8' }).trim().split('\n');
assert.deepEqual(inStash, ['README.md'], 'git stash create 只包含已跟踪的文件，新建的 src/list.ts 不在里面');
console.log(`有改动时再运行一次：快照里的文件是 ${inStash.join('、')}；新建的 src/list.ts ${inStash.includes('src/list.ts') ? '在' : '不在'}里面（git stash create 只管已跟踪的文件）。`);
