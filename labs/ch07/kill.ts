// 第 7 章实验：真的把 mox 杀掉，再用 -c 恢复。
//   node labs/ch07/kill.ts
// 第一次运行：模型要求先跑一个很快的命令，再跑一个要 30 秒的命令。等第二个命令开始执行，立刻 kill -9 整个进程组。
// 第二次运行：mox -c 恢复同一个会话。看磁盘上留下了什么、恢复时补了什么、模型这次收到的请求长什么样。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killGroup, runMox, spawnMox, startFakeModel } from '../shared/mox-cli.ts';

const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), name)));   // 会话目录名用真实路径，macOS 的 /var 实际是 /private/var
const home = tmp('ch07-home-');
const project = tmp('ch07-proj-');
const sessionDir = join(home, '.mox', 'sessions');
const show = (m: any) => {
  if (m.role === 'assistant' && m.tool_calls) return `assistant   调用 ${m.tool_calls.map((c: any) => `${c.function.name}(${JSON.parse(c.function.arguments).command})`).join('、')}`;
  const text = String(m.content).replace(/\s+/g, ' ');
  return `${m.role.padEnd(11)} ${text.length > 60 ? text.slice(0, 60) + '…' : text}`;
};
const records = () => {
  const dir = join(sessionDir, readdirSync(sessionDir)[0]);
  const file = join(dir, readdirSync(dir)[0]);
  return readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l).message);
};

try {
  // ── 第一次运行：被杀掉 ──
  const first = await startFakeModel((_request, n) => n === 1
    ? { toolCalls: [{ name: 'bash', arguments: { command: 'echo 第一个命令' } }, { name: 'bash', arguments: { command: 'sleep 30' } }] }
    : { text: '（不会走到这里）' });
  const run = spawnMox(['--yolo', '-p', '依次运行 echo 和 sleep'], { cwd: project, home, url: first.url });
  await run.until(/sleep 30/);                        // “● bash {"command":"sleep 30"}” 打印出来，说明这个命令正要开始
  await new Promise(r => setTimeout(r, 300));
  killGroup(run);                                     // kill -9：不给进程任何收尾的机会
  await run.done;
  first.close();
  console.log('第一次运行，kill -9 之后，磁盘上的会话文件：');
  const onDisk = records();
  onDisk.forEach((m, i) => console.log(`  ${i + 1}. ${show(m)}`));
  assert.deepEqual(onDisk.map(m => m.role), ['user', 'assistant', 'tool']);

  // ── 第二次运行：-c 恢复 ──
  const second = await runMox(['-c', '-p', '刚才断了，继续'], { cwd: project, home, script: () => ({ text: '好的，我先检查一下 sleep 有没有执行完。' }) });
  const sent = second.requests[0].messages.slice(1);        // 第 0 条是系统提示
  console.log('\n第二次运行 mox -c，第一次请求发给模型的消息：');
  sent.forEach((m, i) => console.log(`  ${i + 1}. ${show(m)}`));
  assert.deepEqual(sent.map(m => m.role), ['user', 'assistant', 'tool', 'tool', 'user']);
  assert.match(sent[3].content, /^中断/);
  assert.equal(sent[3].tool_call_id, sent[1].tool_calls[1].id);

  // 补上的“中断”是写进文件的，再恢复一次不会重复补
  const third = await runMox(['-c', '-p', '再来一次'], { cwd: project, home, script: () => ({ text: '收到。' }) });
  const interrupts = third.requests[0].messages.filter(m => m.role === 'tool' && String(m.content).startsWith('中断')).length;
  console.log(`\n第三次再 -c：请求里“中断”结果有 ${interrupts} 条（第二次恢复时已经写进文件，不会重复补）`);
  assert.equal(interrupts, 1);
  console.log(`最后，会话文件共 ${records().length} 行。`);
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
}
