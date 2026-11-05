// 第 19 章实验：用 RPC 控制 labs/ch19/mox-rpc.ts（在 runLoop 之上写的最小 RPC 宿主）。父进程是“客户端”，它是长期运行的子进程。
// 左边的数字是这一行在整个对话里的序号。模型是本机起的假服务器，按剧本回复。
//   node labs/ch19/rpc.ts
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serverConfig } from './servers.ts';

const config = await serverConfig('mox', '0.6');
const child = spawn(process.execPath, [config.cliPath], {
  cwd: config.cwd,
  // HOME 指向临时目录：不加载你本机 ~/.mox 和 ~/.agents 里的东西
  env: { ...process.env, ...config.env },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let step = 0;                                   // 行号而不是时间戳：每次运行的输出完全一样
const at = () => String(++step).padStart(2);
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
    const brief = r.type === 'response' ? `response ${r.command}${r.id ? ` #${r.id}` : ''} ${r.success ? '✓' : '✗'} ${JSON.stringify(r.data ?? r.error ?? '').replace(/"sessionId":"[0-9a-f-]+"/, '"sessionId":"…"').slice(0, 90)}`
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
config.close();
console.log(`mox-rpc 退出，退出码 ${code}`);
