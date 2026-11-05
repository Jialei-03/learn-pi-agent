// 第 16 章实战检验：给 mox 加上计划模式、任务清单和检查点。
//   node labs/ch16/practice.ts [plan|todo|checkpoint]     不带参数就三部分都跑；检验参考实现 extensions/*/mox.ts
//   MOX_DIR=~/my-mox node labs/ch16/practice.ts           检验你自己的 mox，扩展放在 ~/my-mox/extensions/{plan-mode,todo,checkpoint}.ts
// 约定：扩展默认导出 (mox) => {}；计划模式注册 /mode 和 exit_plan_mode，任务清单注册 todo_write，检查点注册 /rewind。
// 模型是脚本，runLoop、工具、扩展都是真的；终端是脚本化的 ask。
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { whose } from '../shared/mox-dir.ts';
import { scripted } from '../shared/scripted.ts';
import { callsInOrder, runCli } from '../ch14/cli-run.ts';
import { assemble, describe, extFile, firstLine } from '../ch14/host.ts';
import type { ExtensionApi } from '../../mox/src/extensions.ts';

const only = process.argv[2];
const want = (part: string) => !only || only === part;
const home = mkdtempSync(join(tmpdir(), 'ch16-home-'));
process.env.HOME = home;                                    // 检查点的影子仓库放在 ~/.mox/checkpoints
console.log(`${whose()}\n`);
const call = (name: string, args: object) => ({ toolCalls: [{ name, arguments: args }] });
const quietly = async <T>(f: () => Promise<T>) => { const w = process.stdout.write; process.stdout.write = () => true; try { return await f(); } finally { process.stdout.write = w; } };

// ── 计划模式 ──────────────────────────────────────────────────
if (want('plan')) {
  console.log('## 计划模式\n');
  const plan = '1. 在 src/cli.ts 的命令分支里加上 list\n2. list 读取所有笔记并按时间倒序打印\n3. 运行 node --check src/cli.ts 验证语法';
  const edit = { name: 'edit', arguments: { path: 'src/cli.ts', edits: [{ oldText: 'add();', newText: "add();\nelse if (command === 'list') list();" }] } };
  const steps = [{ name: 'read', arguments: { path: 'src/cli.ts' } }, edit, { name: 'bash', arguments: { command: 'ls src && wc -l src/cli.ts' } }, { name: 'exit_plan_mode', arguments: { plan } }, edit];
  const run = async (order: 'plan-first' | 'permissions-first') => {
    const cwd = mkdtempSync(join(tmpdir(), 'ch16-plan-'));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'cli.ts'), "if (command === 'add') add();\n");
    const model = scripted((_m, n) => (n <= steps.length ? { toolCalls: [steps[n - 1]] } : { text: '已按计划加上 list 命令。' }));
    const sources = [extFile('plan-mode'), extFile('permissions'), extFile('todo')];
    if (order === 'permissions-first') [sources[0], sources[1]] = [sources[1], sources[0]];
    const host = await assemble({ cwd, model, sources, answers: q => (q.startsWith('批准这个计划') ? '批准' : '允许一次') });
    await quietly(() => host.command('/mode plan'));
    await host.run('给 mox 加一个 list 命令');
    return { host, model, cwd };
  };
  const { host, model, cwd } = await run('plan-first');
  const label = (s: { name: string; args: any }) => (s.name === 'exit_plan_mode' ? 'exit_plan_mode（提交计划）' : describe(s as any));
  for (const s of host.steps) console.log(`${s.error ? '✗' : '✓'} ${label(s).padEnd(28)} ${s.name === 'exit_plan_mode' ? s.result : firstLine(s.result, 64)}`);
  const ask = (q: string) => q.split('\n')[0].replace(/\{.*$/, '…');
  console.log(`\n弹出的对话框：${host.questions.map(q => `${ask(q.question)} → 「${q.reply}」`).join('；')}\n`);
  console.log('| 第几次请求 | 系统提示里有计划模式说明 | exit_plan_mode 在工具列表里 |\n| --- | --- | --- |');
  const rows = model.requests.map((r, i) => ({ n: i + 1, prompt: String((r.messages[0] as any).content).includes('<plan-mode>'), tool: r.tools!.some(t => t.name === 'exit_plan_mode') }));
  for (const r of rows) console.log(`| ${r.n}${r.n === 5 ? '（批准之后，同一次运行）' : ''} | ${r.prompt ? '有' : '没有'} | ${r.tool ? '在' : '不在'} |`);
  await host.run('再给 list 加上 --limit 参数');
  console.log(`| 下一次提问 | ${String(model.requests.at(-1)!.messages[0].content).includes('<plan-mode>') ? '有' : '没有'} | 在 |\n`);
  assert.deepEqual(host.steps.map(s => `${s.name}:${s.error ? '拒绝' : '通过'}`), ['read:通过', 'edit:拒绝', 'bash:通过', 'exit_plan_mode:通过', 'edit:通过']);
  assert.deepEqual(host.questions.map(q => ask(q.question)), ['批准这个计划吗？', '允许执行吗？edit …'], '计划模式里被拒绝的 edit 不弹框；整个过程只弹两个：批准计划，批准之后第一次 edit 的权限确认');
  assert.ok(rows.every(r => r.prompt), '同一次运行里系统提示不更新');
  assert.ok(!String(model.requests.at(-1)!.messages[0].content).includes('<plan-mode>'), '下一次提问，说明就没有了');
  assert.equal(readFileSync(join(cwd, 'src', 'cli.ts'), 'utf8'), "if (command === 'add') add();\nelse if (command === 'list') list();\n");
  // 加载顺序：拒绝优先，所以顺序不影响安全；但权限扩展在前时，用户会被白问一次
  const swapped = await run('permissions-first');
  console.log(`加载顺序：计划模式在前，批准计划之前用户被问 0 次；权限扩展在前，被问 ${swapped.host.questions.findIndex(q => q.question.startsWith('批准'))} 次，计划模式里的 edit 仍然${swapped.host.steps[1].error ? '被拒绝' : '执行了'}。\n`);
  assert.ok(swapped.host.steps[1].error, '拒绝优先：权限扩展放行了，计划模式仍然拒绝');
  assert.equal(swapped.host.questions.findIndex(q => q.question.startsWith('批准')), 1);
  // 真正的命令行：/mode plan，再提任务
  const real = await runCli({
    script: callsInOrder([{ name: 'read', arguments: { path: 'src/cli.ts' } }, edit, { name: 'exit_plan_mode', arguments: { plan: '1. 在 src/cli.ts 里加 list 分支' } }, edit]),
    prompt: ['/mode plan', '给 cli 加一个 list 命令'], flags: ['-e', extFile('plan-mode'), '-e', extFile('permissions')], answers: ['1', '1'],
    project: { 'src/cli.ts': "if (command === 'add') add();\n" },
  });
  console.log('真正的命令行（mox -e plan-mode -e permissions，借伪终端输入 /mode plan 和任务）：');
  for (const o of real.outcomes) console.log(`${o.ok ? '✓' : '✗'} ${o.what.slice(0, 30).padEnd(30)} ${o.result.replace(/\s+/g, ' ').replace(/^错误：/, '').slice(0, 60)}`);
  console.log();
  assert.deepEqual(real.outcomes.map(o => o.ok), [true, false, true, true]);
  assert.ok(real.outcomes[2].result.includes('用户批准了计划'));
}

// ── 任务清单 ──────────────────────────────────────────────────
if (want('todo')) {
  console.log('## 任务清单\n');
  const names = ['读懂现有的命令解析', '实现 list 命令', '补测试'];
  const list = (...status: string[]) => ({ todos: names.map((content, i) => ({ content, status: status[i] })) });
  const writes = [list('pending', 'pending', 'pending'), list('in_progress', 'pending', 'pending'), list('completed', 'in_progress', 'in_progress'), { todos: [{ content: '补测试', status: 'doing' }] }, list('completed', 'in_progress', 'pending')];
  const model = () => scripted((_m, n) => (n <= writes.length ? call('todo_write', writes[n - 1]) : { text: '先做到这里。' }));
  const cwd = mkdtempSync(join(tmpdir(), 'ch16-todo-'));
  const host = await assemble({ cwd, model: model(), sources: [extFile('todo')], yolo: true });
  await host.run('给 mox 加 list 命令，记得补测试');
  for (const s of host.steps) console.log(`${s.error ? '✗' : '✓'} ${s.result.split('\n').filter(Boolean).join(' | ')}`);
  assert.deepEqual(host.steps.map(s => !s.error), [true, true, false, false, true], '两个 in_progress、status 写错：拒绝，状态保持不变');
  const reminder = () => host.system().split('\n\n').find(p => p.startsWith('<todos>')) ?? '（没有）';
  console.log(`\n下一次运行时，系统提示末尾的清单：\n  ${reminder().split('\n').join('\n  ')}`);
  assert.ok(reminder().includes('◐ 实现 list 命令') && reminder().includes('☐ 补测试'));
  const done = await assemble({ cwd, model: scripted([call('todo_write', list('completed', 'completed', 'completed')), { text: '全部完成。' }]), sources: [extFile('todo')], yolo: true });
  await done.run('收尾');
  assert.ok(!done.system().includes('<todos>'), '全部完成之后不再提醒');
  const resumed = await assemble({ cwd, model: model(), sources: [extFile('todo')], yolo: true });
  resumed.messages.push(...host.messages);
  console.log(`\n恢复会话（mox -c）：对话里有 ${resumed.messages.length} 条消息，系统提示里的清单：${resumed.system().includes('<todos>') ? '有' : '没有（扩展是新的，内存是空的）'}`);
  assert.ok(!resumed.system().includes('<todos>'));
  const asked = await assemble({ cwd, model: model(), sources: [extFile('todo')], answers: ['本次会话都允许'] });
  await asked.run('给 mox 加 list 命令');
  console.log(`没有权限扩展时，五次 todo_write 内置确认只问了 ${asked.questions.length} 次（选了“本次会话都允许”之后不再问）。\n`);
  assert.equal(asked.questions.length, 1);
}

// ── 检查点 ────────────────────────────────────────────────────
if (want('checkpoint')) {
  console.log('## 检查点\n');
  const project = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ch16-'));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'cli.ts'), "if (command === 'add') add();\n");
    writeFileSync(join(cwd, 'README.md'), '# mox notes\n');
    execSync('git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm init', { cwd });
    return cwd;
  };
  const files = (cwd: string) => ['src/cli.ts', 'src/list.ts', 'README.md'].map(f => `${f}：${existsSync(join(cwd, f)) ? JSON.stringify(readFileSync(join(cwd, f), 'utf8').trim()) : '（不存在）'}`).join('\n    ');
  const replies = [
    call('bash', { command: 'ls src' }),                                                                                  // 只读：不拍快照
    call('edit', { path: 'src/cli.ts', edits: [{ oldText: 'add();', newText: "add();\nelse if (command === 'list') list();" }] }),
    call('bash', { command: "echo '用法：mox list' >> README.md" }),
    call('bash', { command: "printf 'export function list() {}\\n' > src/list.ts" }),
    { text: '加好了。' },
    call('bash', { command: 'rm README.md' }),
    { text: '删掉了。' },
  ];
  const cwd = project();
  const original = files(cwd);
  let pick = 'edit src/cli.ts';
  const host = await assemble({
    cwd, model: scripted(replies), yolo: true, sources: [extFile('checkpoint')],
    answers: (question, choices) => {
      const choice = choices.find(c => c.includes(pick)) ?? choices[0];
      console.log(`? ${question}\n${choices.map(c => `    ${c}`).join('\n')}\n  → 选「${choice}」`);
      return choice;
    },
  });
  await host.run('加一个 list 命令');
  await host.run('README 没用了，删掉');
  const afterBoth = files(cwd);
  console.log(`两次提问之后：\n    ${afterBoth}\n\n$ /rewind`);
  assert.notEqual(afterBoth, original);
  await host.command('/rewind');
  const menu = host.questions[0].choices;
  console.log(`之后：\n    ${files(cwd)}`);
  assert.equal(menu.length, 4, 'ls 是只读命令，没有检查点；edit、两条写文件的 bash、rm 各有一个');
  assert.ok(!menu.some(m => m.includes('ls src')));
  assert.equal(files(cwd), original, '三个文件全部回到原样');
  const next = host.system();
  console.log(`\n下一次运行的系统提示末尾：${next.split('\n\n').at(-1)}`);
  assert.ok(next.includes('/rewind'), '恢复之后，下一次运行的系统提示告诉模型磁盘变了');
  assert.ok(!host.system().includes('/rewind'), '提示只出现一次');
  console.log('\n$ /rewind  （撤销刚才的 /rewind）');
  pick = '/rewind 之前';
  await host.command('/rewind');
  console.log(`之后：\n    ${files(cwd)}`);
  assert.equal(files(cwd), afterBoth, '/rewind 本身也可以撤销');

  // 陷阱：tool_call 处理器返回字符串就是拒绝。把 snapshot 的返回值顺手 return 出去，每个写操作都会被拒绝
  const trapCwd = project();
  const naive = (mox: ExtensionApi) => mox.on('tool_call', (name: string) => (name === 'write' ? execSync('git rev-parse HEAD', { cwd: trapCwd }).toString().trim() : undefined));
  const trap = await assemble({ cwd: trapCwd, yolo: true, sources: [naive], model: scripted([call('write', { path: 'x.txt', content: 'x' }), { text: '好了。' }]) });
  await trap.run('写个文件');
  console.log(`\n一个常见的错误：处理器把快照的提交号顺手 return 了。write 的结果是「${trap.steps[0].result.replace(/[0-9a-f]{40}/, '<40 位提交号>')}」，x.txt ${existsSync(join(trapCwd, 'x.txt')) ? '写出来了' : '没有写出来'}。`);
  assert.ok(/^错误：[0-9a-f]{40}$/.test(trap.steps[0].result) && !existsSync(join(trapCwd, 'x.txt')));

  // 真正的命令行：两次写入，/rewind 选第 2 项（菜单里最新的在最前面）
  const real = await runCli({
    script: callsInOrder([{ name: 'write', arguments: { path: 'src/list.ts', content: 'export {};\n' } }, { name: 'bash', arguments: { command: "echo '用法：mox list' >> README.md" } }]),
    prompt: ['加一个 list 命令', '/rewind', '收到'], flags: ['--yolo', '-e', extFile('checkpoint')], answers: ['2'], project: { 'README.md': '# notes\n' },
  });
  console.log(`\n真正的命令行（mox --yolo -e checkpoint）：两次写入，/rewind 选第 2 项之后，src/list.ts ${real.exists('src/list.ts') ? '还在' : '不在了'}；下一次提问的系统提示里${real.requests.at(-1)!.messages[0].content!.includes('/rewind') ? '有' : '没有'} /rewind 的说明。`);
  assert.ok(!real.exists('src/list.ts'));
  assert.ok(real.requests.at(-1)!.messages[0].content!.includes('/rewind'));
}
