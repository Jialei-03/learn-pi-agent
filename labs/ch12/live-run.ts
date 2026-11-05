// 第 12 章：用真实模型跑 mox + MCP（需要 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL；网站构建时不运行）。
//   eval "$(python3 /tmp/mox-keys.py minimax)"; export MOX_MODEL=MiniMax-M3.1-Flash
//   node labs/ch12/live-run.ts > labs/ch12/recorded/live-run.txt
// 在临时项目里写一份 .mox/mcp.json，指向实验用的 issue 服务器，用 --trust --yolo 启动 mox（隔离的家目录）。
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { serverCommand } from './shared.ts';

const project = realpathSync(mkdtempSync(join(tmpdir(), 'ch12-live-proj-')));
const home = realpathSync(mkdtempSync(join(tmpdir(), 'ch12-live-home-')));
mkdirSync(join(project, '.mox'));
writeFileSync(join(project, '.mox', 'mcp.json'), JSON.stringify({ mcpServers: { issues: serverCommand } }, null, 2));
const cli = new URL('../../mox/src/cli.ts', import.meta.url).pathname;
const task = '看看现在有哪些 open 的 issue。如果没有关于“MCP 服务器断线重连”的，就新建一个，标签用 feature。最后告诉我你做了什么。';
console.log(`$ mox --trust --yolo -p "${task}"\n`);
const r = spawnSync(process.execPath, [cli, '--trust', '--yolo', '-p', task], { cwd: project, encoding: 'utf8', env: { ...process.env, HOME: home } });
process.stdout.write((r.stderr + r.stdout).replace(/\x1b\[[0-9;]*m/g, '').replaceAll(userInfo().username, 'user').replace(/(\/private)?\/var\/folders\/\S+/g, '<临时目录>'));
