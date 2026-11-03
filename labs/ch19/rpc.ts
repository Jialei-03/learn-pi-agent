// 第 19 章实验：用 RPC 控制 mox。父进程是“客户端”，mox 是长期运行的子进程。
//   node labs/ch19/rpc.ts
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), 'ch19-'));
const child = spawn(process.execPath, [join(repo, 'mox/src/cli.ts'), '--mode', 'rpc', '--no-session'], {
  cwd,
  // HOME 指向临时目录：不加载你本机 ~/.mox 和 ~/.agents 里的东西
  env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'ch19-home-')), MOX_API: 'scripted', MOX_SCRIPT: join(repo, 'labs/ch19/script.ts') },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(5);
const records: any[] = [];
const waiters: { test: (r: any) => boolean; resolve: (r: any) => void }[] = [];
let buffer = '';
child.stdout.on('data', d => {
  buffer += d;
  let i: number;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    const r = JSON.parse(line);
    records.push(r);
    const brief = r.type === 'response' ? `response ${r.command}${r.id ? ` #${r.id}` : ''} ${r.success ? '✓' : '✗'} ${JSON.stringify(r.data ?? r.error ?? '').slice(0, 90)}`
      : r.type === 'message_end' ? `message_end（${r.message.role}）`
      : r.type === 'tool_start' ? `tool_start ${r.name} ${JSON.stringify(r.arguments)}`
      : r.type === 'tool_end' ? `tool_end ${JSON.stringify(r.content.trim())}`
      : r.type === 'text_delta' ? `text_delta ${JSON.stringify(r.delta)}`
      : r.type;
    console.log(`${at()} ← ${brief}`);
    for (const w of [...waiters]) if (w.test(r)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(r); }
  }
});
const until = (test: (r: any) => boolean) => new Promise<any>(resolve => waiters.push({ test, resolve }));
const send = (raw: string) => { console.log(`${at()} → ${raw}`); child.stdin.write(`${raw}\n`); };

send(JSON.stringify({ id: '1', type: 'get_state' }));
await until(r => r.id === '1');
const settled = until(r => r.type === 'agent_settled');
send(JSON.stringify({ id: '2', type: 'prompt', message: '构建项目' }));
await until(r => r.type === 'tool_start');
send(JSON.stringify({ id: '3', type: 'prompt', message: '顺便看看有没有警告' }));    // 运行中：作为插话排队
await settled;
send('{"id": "4", "type": "prompt", "message": ');                                  // 写坏的命令
await until(r => r.command === 'parse');
send(JSON.stringify({ id: '5', type: 'get_messages' }));
const all = await until(r => r.id === '5');
console.log(`\n会话里共有 ${all.data.messages.length} 条消息：${all.data.messages.map((m: any) => m.role).join(' → ')}`);
child.stdin.end();                                                                     // 关闭 stdin = 请求退出
const code = await new Promise(r => child.once('close', r));
console.log(`mox 退出，退出码 ${code}`);
