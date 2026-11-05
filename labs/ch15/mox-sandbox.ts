// 第 15 章实验：沙箱扩展装进 mox。扩展用 registerTool 把内置的 bash 换成沙箱里的 bash。
//   node labs/ch15/mox-sandbox.ts
// 脚本模型、真正的 runLoop 和工具、真正的扩展。只在验证过的平台（macOS 的 Seatbelt）上运行。
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSandboxMoxExtension } from '../../extensions/sandbox/mox.ts';
import { detectSandbox } from '../../extensions/sandbox/policy.ts';
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import { scripted } from '../shared/scripted.ts';
import { callsInOrder, runCli } from '../ch14/cli-run.ts';
import { assemble } from '../ch14/host.ts';

if (detectSandbox() !== 'seatbelt') { console.log('这台机器不是 macOS（Seatbelt），沙箱探针只在验证过的平台上运行，跳过实验。'); process.exit(0); }

const root = mkdtempSync(join(tmpdir(), 'ch15-mox-'));
const cwd = join(root, 'project'), outside = join(root, 'outside');
mkdirSync(cwd); mkdirSync(outside);
writeFileSync(join(cwd, '.env'), 'DB_PASSWORD=hunter2\n');

const commands = [
  'echo "console.log(1)" > index.js && node index.js',
  `python3 -c "print(open('.env').read())"`,
  'head -1 ~/.ssh/id_rsa',
  `touch ${outside}/pwned.txt`,
  'curl -sS -m 5 https://example.com -o /dev/null || echo "curl 失败，退出码 $?"',
];
// 旁观者：记下 tool_call 事件里看到的命令。一个在沙箱之前加载，一个在之后
const seen: Record<string, string[]> = { before: [], after: [] };
const spy = (key: string) => (mox: ExtensionApi) => mox.on('tool_call', (name: string, args: { command?: string }) => { if (name === 'bash') seen[key].push(args.command!); });

// 最后一步换成 write 工具，写到同一个项目外的目录：沙箱只管 bash
const calls = [...commands.map(command => ({ name: 'bash', arguments: { command } })), { name: 'write', arguments: { path: `${outside}/written.txt`, content: 'x\n' } }];
const model = scripted((_m, n) => (n <= calls.length ? { toolCalls: [calls[n - 1]] } : { text: '完成。' }));
const host = await assemble({ cwd, model, yolo: true, sources: [spy('before'), createSandboxMoxExtension({ denyRead: ['.env'] }), spy('after')] });

const bash = host.tools.find(t => t.name === 'bash')!;
console.log(`工具列表：${host.tools.map(t => t.name).join('、')}（bash 只有一个：同名替换，不是新增）`);
console.log(`bash 的描述：${bash.description}\n`);
await host.run('跑几个命令');
await host.shutdown();

for (const s of host.steps) {
  if (s.name === 'write') { console.log(`write …/outside/written.txt\n    ${s.result.replaceAll(root, '…')}`); continue; }
  // 输出里出现的家目录和临时目录换掉：实验结果会放到网站上
  const line = (s.result.split('\n').find(l => /not permitted|EPERM|Operation|curl|console|^1$/.test(l)) ?? s.result.split('\n')[0]).replaceAll(homedir(), '~').replaceAll(root, '…');
  console.log(`$ ${s.args.command.replaceAll(root, '…')}\n    ${line.slice(0, 90)}`);
}

// 模型写的原始命令留在对话里，事件里看到的也是原始命令：和扩展的加载顺序无关
const recorded = host.messages.flatMap(m => (m.role === 'assistant' ? m.tool_calls ?? [] : [])).filter(c => c.function.name === 'bash').map(c => JSON.parse(c.function.arguments).command);
console.log(`\n对话记录里是原始命令：${recorded.every(c => !c.includes('sandbox-exec'))}；沙箱之前的扩展看到的是原始命令：${seen.before.every(c => !c.includes('sandbox-exec'))}；沙箱之后的扩展看到的是原始命令：${seen.after.every(c => !c.includes('sandbox-exec'))}`);
assert.deepEqual(recorded, commands);
assert.deepEqual(seen.before, commands);
assert.deepEqual(seen.after, commands);
assert.equal(host.tools.filter(t => t.name === 'bash').length, 1);
assert.ok(bash.description.includes('沙箱'));
assert.deepEqual(host.steps.map(s => !s.error && !/not permitted|Operation|失败/.test(s.result)), [true, false, false, false, false, true], '只有第一条（在项目里写文件、运行 node）和 write 工具能正常完成');
assert.ok(!existsSync(join(outside, 'pwned.txt')), 'bash 没能在项目外创建文件');
assert.ok(existsSync(join(outside, 'written.txt')), 'write 工具在 mox 进程里运行，不受沙箱限制，写进去了');
assert.ok(existsSync(join(cwd, 'index.js')), '项目里的文件写成功了');

// 同一个扩展接进真正的命令行：mox --yolo -e extensions/sandbox/mox.ts
const real = await runCli({
  script: callsInOrder([{ name: 'bash', arguments: { command: 'echo hi > inside.txt && cat inside.txt' } }, { name: 'bash', arguments: { command: 'echo hi > ../outside.txt' } }]),
  prompt: '写两个文件',
  flags: ['--yolo', '-e', join(process.cwd(), 'extensions/sandbox/mox.ts')],
});
console.log('\n真正的命令行（mox --yolo -e extensions/sandbox/mox.ts）：');
for (const o of real.outcomes) console.log(`$ ${o.what.slice(5)}\n    ${o.result.replace(/\s+/g, ' ').replaceAll(real.project, '…').slice(0, 80)}`);
assert.ok(real.outcomes[0].result.startsWith('hi'));
assert.ok(real.outcomes[1].result.includes('Operation not permitted'));
assert.ok(!real.exists('../outside.txt'));
