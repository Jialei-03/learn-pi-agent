// 第 12 章：用真实模型跑 mox + MCP（需要 MOX_API_KEY，不在网站构建时运行）。
//   node labs/ch12/live-run.ts
// 在临时项目里写一份 .mox/mcp.json，指向实验用的 issue 服务器，然后用 --trust 启动 mox。
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverCommand } from './shared.ts';

const project = mkdtempSync(join(tmpdir(), 'ch12-live-'));
mkdirSync(join(project, '.mox'));
writeFileSync(join(project, '.mox', 'mcp.json'), JSON.stringify({ mcpServers: { issues: serverCommand } }, null, 2));
const cli = fileURLToPath(new URL('../../mox/src/cli.ts', import.meta.url));
const task = '看看现在有哪些 open 的 issue。如果没有关于“MCP 服务器断线重连”的，就新建一个，标签用 feature。最后告诉我你做了什么。';
console.log(`$ mox --trust -p "${task}"\n`);
const r = spawnSync(process.execPath, [cli, '--trust', '-p', task], { cwd: project, encoding: 'utf8', env: process.env });
process.stdout.write((r.stderr + r.stdout).replace(/\x1b\[[0-9;]*m/g, ''));
