// 第 15 章实战检验：给 mox 加上沙箱。用 registerTool 同名替换内置的 bash，把命令包进 sandbox-exec。
//   node labs/ch15/practice.ts                      检验参考实现（extensions/sandbox/mox.ts）
//   MOX_DIR=~/my-mox node labs/ch15/practice.ts     检验你自己的 mox（扩展放在 ~/my-mox/extensions/sandbox.ts）
// 沙箱探针只在验证过的平台（macOS 的 Seatbelt）上运行，其他平台跳过。
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectSandbox } from '../../extensions/sandbox/policy.ts';
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import { whose } from '../shared/mox-dir.ts';
import { scripted } from '../shared/scripted.ts';
import { callsInOrder, runCli } from '../ch14/cli-run.ts';
import { assemble, extFile } from '../ch14/host.ts';

console.log(`${whose()}\n`);
if (detectSandbox() !== 'seatbelt') { console.log('这台机器不是 macOS（Seatbelt），沙箱探针只在验证过的平台上运行，跳过。'); process.exit(0); }

const root = mkdtempSync(join(tmpdir(), 'ch15-mox-'));
const cwd = join(root, 'project'), outside = join(root, 'outside'), home = join(root, 'home');
for (const d of [cwd, outside, join(home, '.ssh')]) mkdirSync(d, { recursive: true });
writeFileSync(join(home, '.ssh', 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\n');
process.env.HOME = home;                                   // 沙箱默认禁止读 ~/.ssh：这里指向一个假的家目录

const commands = [
  'echo "console.log(1)" > index.js && node index.js',
  `python3 -c "print(open('${home}/.ssh/id_rsa').read())"`,
  `touch ${outside}/pwned.txt`,
  'curl -sS -m 5 https://example.com -o /dev/null || echo "curl 失败，退出码 $?"',
];
// 两个旁观者，一个在沙箱之前加载，一个在之后，记下 tool_call 里看到的命令
const seen: Record<string, string[]> = { before: [], after: [] };
const spy = (key: string) => (mox: ExtensionApi) => mox.on('tool_call', (name: string, args: { command?: string }) => { if (name === 'bash') seen[key].push(args.command!); });
// 最后一步换成 write 工具，写到同一个项目外的目录：沙箱只管 bash
const calls = [...commands.map(command => ({ name: 'bash', arguments: { command } })), { name: 'write', arguments: { path: `${outside}/written.txt`, content: 'x\n' } }];
const host = await assemble({ cwd, yolo: true, model: scripted((_m, n) => (n <= calls.length ? { toolCalls: [calls[n - 1]] } : { text: '完成。' })), sources: [spy('before'), extFile('sandbox'), spy('after')] });

const bash = host.tools.find(t => t.name === 'bash')!;
console.log(`工具列表：${host.tools.map(t => t.name).join('、')}（bash 只有一个：同名替换，不是新增）`);
console.log(`bash 的描述：${bash.description}\n`);
await host.run('跑几个命令');
await host.shutdown();

console.log('| 调用 | 结果 |\n| --- | --- |');
for (const s of host.steps) {
  const what = s.name === 'write' ? 'write …/outside/written.txt' : s.args.command.replaceAll(root, '…').replaceAll(home, '~').replace(/\|/g, '\\|');
  const line = (s.result.split('\n').find(l => /not permitted|EPERM|Operation|curl|console|^1$|已写入/.test(l)) ?? s.result.split('\n')[0]).replaceAll(root, '…').replaceAll(home, '~');
  console.log(`| \`${what.slice(0, 60)}\` | ${line.slice(0, 70).replace(/\|/g, '\\|')} |`);
}
const recorded = host.messages.flatMap(m => (m.role === 'assistant' ? m.tool_calls ?? [] : [])).filter(c => c.function.name === 'bash').map(c => JSON.parse(c.function.arguments).command);
console.log(`\n对话记录里是原始命令：${recorded.every(c => !c.includes('sandbox-exec'))}；沙箱之前的扩展看到的是原始命令：${seen.before.every(c => !c.includes('sandbox-exec'))}；沙箱之后的扩展看到的是原始命令：${seen.after.every(c => !c.includes('sandbox-exec'))}`);

assert.equal(host.tools.filter(t => t.name === 'bash').length, 1, 'bash 只有一个：同名替换');
assert.ok(bash.description.includes('沙箱'), '描述里告诉模型它在沙箱里');
assert.deepEqual(recorded, commands, '对话记录里是模型写的原始命令');
assert.deepEqual(seen.before, commands);
assert.deepEqual(seen.after, commands, '扩展的加载顺序不影响 tool_call 看到的命令');
assert.deepEqual(host.steps.map(s => !s.error && !/not permitted|Operation|失败/.test(s.result)), [true, false, false, false, true], '只有项目里的写入和 write 工具能完成');
assert.ok(existsSync(join(cwd, 'index.js')), '项目里的文件写成功了');
assert.ok(!existsSync(join(outside, 'pwned.txt')), 'bash 没能在项目外创建文件');
assert.ok(existsSync(join(outside, 'written.txt')), 'write 工具在 mox 进程里运行，不受沙箱限制');

// 接进真正的命令行：mox --yolo -e sandbox
const real = await runCli({
  script: callsInOrder([{ name: 'bash', arguments: { command: 'echo hi > inside.txt && cat inside.txt' } }, { name: 'bash', arguments: { command: 'echo hi > ../outside.txt' } }]),
  prompt: '写两个文件', flags: ['--yolo', '-e', extFile('sandbox')],
});
console.log('\n真正的命令行（mox --yolo -e sandbox）：');
for (const o of real.outcomes) console.log(`$ ${o.what.slice(5)}\n    ${o.result.replace(/\s+/g, ' ').replaceAll(real.project, '…').slice(0, 80)}`);
assert.ok(real.outcomes[0].result.startsWith('hi'));
assert.ok(real.outcomes[1].result.includes('Operation not permitted'));
assert.ok(!real.exists('../outside.txt'));
