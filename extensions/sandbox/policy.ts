// 操作系统级沙箱的策略（第 15 章）：命令只能写哪些目录、不能读哪些路径、能不能上网。
// macOS 用 Seatbelt（sandbox-exec），Linux 用 bubblewrap（bwrap）。限制由内核执行，命令用什么语言、怎么写都绕不过去。
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export interface SandboxPolicy {
  /** 可以写的目录；之外一律不能写 */
  writable: string[];
  /** 可写目录里仍然不能写的路径：写进去的东西会在沙箱外被执行 */
  denyWrite: string[];
  /** 不能读的文件或目录 */
  denyRead: string[];
  /** none：完全断网；proxy：只能连本地代理，由代理按域名白名单放行 */
  network: 'none' | 'proxy';
  proxyPort?: number;
}

export type SandboxKind = 'seatbelt' | 'bwrap';

export function detectSandbox(): SandboxKind | undefined {
  const has = (cmd: string) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
  if (process.platform === 'darwin' && has('sandbox-exec')) return 'seatbelt';
  if (process.platform === 'linux' && has('bwrap')) return 'bwrap';
}

/** 内核看到的是真实路径：macOS 的 /tmp、/var 都是 /private 下的符号链接，写进策略之前必须解析。 */
export function real(p: string): string {
  try { return realpathSync(p); } catch { const parent = dirname(p); return parent === p ? p : join(real(parent), basename(p)); }
}

/** 默认不让读的东西：凭据和密钥。 */
export function defaultDenyRead(home = homedir()): string[] {
  return ['.ssh', '.aws', '.gnupg', '.config/gcloud', '.netrc', '.pi/agent/auth.json'].map(p => join(home, p));
}

/**
 * 项目目录可写，但其中有些文件会在沙箱外被执行或被信任：git 钩子（下次你在沙箱外 git commit 时运行）、
 * git 配置（core.fsmonitor 等可以指定任意程序）、Agent 自己的配置和扩展目录（下次启动时加载）。
 */
export function defaultDenyWrite(cwd: string): string[] {
  return ['.git/hooks', '.git/config', '.pi', '.mox', '.claude', '.mcp.json', '.vscode', '.idea'].map(p => join(cwd, p));
}

const q = (p: string) => `"${real(p).replace(/[\\"]/g, '\\$&')}"`;

/** Seatbelt 策略：默认允许，再收紧写入、读取和网络。后写的规则优先。 */
export function seatbeltProfile(policy: SandboxPolicy): string {
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${policy.writable.map(p => `(subpath ${q(p)})`).join(' ')} (literal "/dev/null") (regex #"^/dev/tty") (regex #"^/dev/fd/"))`,
    ...(policy.denyWrite.length ? [`(deny file-write* ${policy.denyWrite.map(p => `(subpath ${q(p)})`).join(' ')})`] : []),
    ...(policy.denyRead.length ? [`(deny file-read* ${policy.denyRead.map(p => `(subpath ${q(p)})`).join(' ')})`] : []),
    '(deny network*)',
    ...(policy.network === 'proxy' && policy.proxyPort ? [`(allow network-outbound (remote ip "localhost:${policy.proxyPort}"))`] : []),
  ].join('\n');
}

/**
 * bubblewrap 参数：整个文件系统只读挂载，可写目录重新以读写方式挂载，禁止读取的路径用空目录或 /dev/null 盖住。
 * 注意：--unshare-net 会让沙箱里连本地代理都连不上，这里 proxy 模式只设置代理环境变量，不在内核层面断网——
 * Claude Code 在 Linux 上的做法是把代理通过 unix socket 接进网络命名空间，本书没有实现这一步。
 */
export function bwrapArgs(policy: SandboxPolicy): string[] {
  return [
    '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent',
    ...policy.writable.flatMap(p => ['--bind', real(p), real(p)]),
    ...policy.denyWrite.filter(p => existsSync(p)).flatMap(p => ['--ro-bind', real(p), real(p)]),
    ...policy.denyRead.flatMap(p => (p.endsWith('/') || !basename(p).includes('.') ? ['--tmpfs', real(p)] : ['--ro-bind', '/dev/null', real(p)])),
    ...(policy.network === 'none' ? ['--unshare-net'] : []),
  ];
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** 把一条命令包进沙箱。返回新的命令和要加的环境变量（代理地址、临时目录）。 */
export function wrapCommand(command: string, policy: SandboxPolicy, kind: SandboxKind, profilePath: string, tmpDir: string): { command: string; env: Record<string, string> } {
  const proxy = policy.network === 'proxy' && policy.proxyPort ? `http://localhost:${policy.proxyPort}` : undefined;
  // 代理变量总是覆盖：断网模式下清空，免得命令继承宿主机自己的代理设置（那会让结果因机器而异）
  const p = proxy ?? '';
  const env: Record<string, string> = { TMPDIR: tmpDir, HTTP_PROXY: p, HTTPS_PROXY: p, ALL_PROXY: p, http_proxy: p, https_proxy: p, all_proxy: p, NO_PROXY: '', no_proxy: '' };
  const inner = `/bin/bash -c ${shellQuote(command)}`;
  return kind === 'seatbelt'
    ? { command: `sandbox-exec -f ${shellQuote(profilePath)} ${inner}`, env }
    : { command: `bwrap ${bwrapArgs(policy).map(shellQuote).join(' ')} -- ${inner}`, env };
}
