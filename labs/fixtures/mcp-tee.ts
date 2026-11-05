// 抓包用的“透明代理”：用法 node mcp-tee.ts <日志文件> <命令> [参数…]
// 它启动真正的 MCP 服务器，把 stdin / stdout 原样转发，同时把每一行（带方向）追加到日志文件。
// 客户端以为自己在和服务器说话，其实中间多了一层它不知道的 tee。
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [log, command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
createInterface({ input: process.stdin }).on('line', line => { appendFileSync(log, `→ ${line}\n`); child.stdin.write(line + '\n'); });
createInterface({ input: child.stdout }).on('line', line => { appendFileSync(log, `← ${line}\n`); process.stdout.write(line + '\n'); });
process.stdin.on('end', () => child.stdin.end());
child.on('exit', code => process.exit(code ?? 0));
process.on('SIGTERM', () => { child.kill('SIGTERM'); process.exit(0); });
