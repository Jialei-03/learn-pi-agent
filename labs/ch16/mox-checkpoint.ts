// 第 16 章实验：检查点与 /rewind 装进 mox。每次 write、edit、会改东西的 bash 之前拍快照；/rewind 把代码退回到某次操作之前。
//   node labs/ch16/mox-checkpoint.ts
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpointMoxExtension } from '../../extensions/checkpoint/mox.ts';
import { CheckpointStore } from '../../extensions/checkpoint/store.ts';
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import { scripted } from '../shared/scripted.ts';
import { assemble } from '../ch14/host.ts';

function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'ch16-'));
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src', 'cli.ts'), "if (command === 'add') add();\n");
  writeFileSync(join(cwd, 'README.md'), '# mox notes\n');
  execSync('git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm init', { cwd });
  return cwd;
}
const files = (cwd: string) => ['src/cli.ts', 'src/list.ts', 'README.md'].map(f => `${f}：${existsSync(join(cwd, f)) ? JSON.stringify(readFileSync(join(cwd, f), 'utf8').trim()) : '（不存在）'}`).join('\n    ');
const call = (name: string, args: object) => ({ toolCalls: [{ name, arguments: args }] });
const replies = [
  call('bash', { command: 'ls src' }),                                                                                  // 只读：不拍快照
  call('edit', { path: 'src/cli.ts', edits: [{ oldText: 'add();', newText: "add();\nelse if (command === 'list') list();" }] }),
  call('bash', { command: "echo '用法：mox list' >> README.md" }),
  call('bash', { command: "printf 'export function list() {}\\n' > src/list.ts" }),
  { text: '加好了。' },                                                                                                  // 第一次提问结束
  call('bash', { command: 'rm README.md' }),
  { text: '删掉了。' },                                                                                                  // 第二次提问结束
];

const cwd = project();
const original = files(cwd);
console.log(`开始时：\n    ${original}\n`);

// 回答 /rewind 的提问：先选 edit 那一条（第一个改动之前），再选「/rewind 之前的状态」
let pick = 'edit src/cli.ts';
const host = await assemble({
  cwd, model: scripted(replies), yolo: true,
  sources: [createCheckpointMoxExtension(join(cwd, '..', `${cwd.split('/').pop()}-shadow.git`))],
  answers: (question, choices) => {
    const choice = choices.find(c => c.includes(pick)) ?? choices[0];
    console.log(`? ${question}\n${choices.map(c => `    ${c}`).join('\n')}\n  → 选「${choice}」`);
    return choice;
  },
});
await host.run('加一个 list 命令');
await host.run('README 没用了，删掉');
const afterBoth = files(cwd);
console.log(`两次提问之后：\n    ${afterBoth}\n`);
assert.notEqual(afterBoth, original);

console.log('$ /rewind');
await host.command('/rewind');
const menu = host.questions[0].choices;
console.log(`之后：\n    ${files(cwd)}\n`);
// 正文的结论：ls 是只读命令，没有快照；edit、两条 bash 写入、rm 各有一个；恢复之后三个文件全部回到原样
assert.equal(menu.length, 4);
assert.ok(!menu.some(m => m.includes('ls src')));
assert.equal(files(cwd), original);

const next = host.system();
console.log(`下一次运行的系统提示末尾：${next.split('\n\n').at(-1)}`);
assert.ok(next.includes('/rewind'), '恢复之后，下一次运行的系统提示会告诉模型磁盘变了');
assert.ok(!host.system().includes('/rewind'), '提示只出现一次');

console.log('\n$ /rewind  （撤销刚才的 /rewind）');
pick = '/rewind 之前';
await host.command('/rewind');
console.log(`之后：\n    ${files(cwd)}`);
assert.equal(files(cwd), afterBoth, '/rewind 本身也可以撤销');

// 陷阱：tool_call 处理器返回字符串就是拒绝。把 snapshot 的返回值（提交号）顺手 return 出去，每个写操作都会被拒绝
console.log('\n━━ 一个常见的错误写法 ━━');
const trapCwd = project();
const store = new CheckpointStore(trapCwd, join(trapCwd, '..', `${trapCwd.split('/').pop()}-shadow.git`));
const naive = (mox: ExtensionApi) => mox.on('tool_call', (name: string, args: { path?: string }) => (name === 'write' ? store.snapshot(`write ${args.path}`) : undefined));
const trap = await assemble({ cwd: trapCwd, yolo: true, sources: [naive], model: scripted([call('write', { path: 'x.txt', content: 'x' }), { text: '好了。' }]) });
await trap.run('写个文件');
console.log(`处理器把 snapshot 返回的提交号顺手 return 了。write 的结果是「${trap.steps[0].result.replace(/[0-9a-f]{40}/, '<40 位提交号>')}」，x.txt ${existsSync(join(trapCwd, 'x.txt')) ? '写出来了' : '没有写出来'}。`);
assert.ok(/^错误：[0-9a-f]{40}$/.test(trap.steps[0].result) && !existsSync(join(trapCwd, 'x.txt')));
