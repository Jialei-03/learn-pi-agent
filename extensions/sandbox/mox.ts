// mox 扩展：让 bash 命令在操作系统沙箱里运行（第 15 章）。
// 做法：用 registerTool 注册一个同名的 bash，替换内置的那个。新的 bash 还是内置的 bash（参数、输出、超时、取消都一样），
// 只是在 run 里把命令包进 sandbox-exec / bwrap。模型写的原始命令留在对话里，tool_call 事件（权限、检查点）看到的也是原始命令，
// 所以不像“在 tool_call 里改写参数”那样，需要操心扩展的加载顺序。
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import { codingTools } from '../../mox/src/tools.ts';
import type { SandboxOptions } from './index.ts';
import { defaultDenyRead, defaultDenyWrite, detectSandbox, seatbeltProfile, wrapCommand, type SandboxPolicy } from './policy.ts';
import { startProxy } from './proxy.ts';

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function createSandboxMoxExtension(options: SandboxOptions = {}) {
  return async (mox: ExtensionApi) => {
    const kind = detectSandbox();
    if (!kind) { process.stderr.write('[sandbox] 没有可用的沙箱（macOS 需要 sandbox-exec，Linux 需要 bwrap），bash 命令将不受限制地运行\n'); return; }
    const proxy = options.allowedDomains?.length ? await startProxy(options.allowedDomains, options.onProxyDecision) : undefined;
    const work = mkdtempSync(join(tmpdir(), 'mox-sandbox-'));
    const tmp = join(work, 'tmp');
    mkdirSync(tmp);
    const policy: SandboxPolicy = {
      writable: [mox.cwd, tmp, ...(options.writable ?? [])],
      denyWrite: defaultDenyWrite(mox.cwd),
      denyRead: [...defaultDenyRead(), ...(options.denyRead ?? []).map(p => (isAbsolute(p) ? p : resolve(mox.cwd, p)))],
      network: proxy ? 'proxy' : 'none',
      proxyPort: proxy?.port,
    };
    const profile = join(work, 'profile.sb');
    writeFileSync(profile, seatbeltProfile(policy));

    const bash = codingTools(mox.cwd).find(t => t.name === 'bash')!;
    mox.registerTool({
      ...bash,
      // 告诉模型它在沙箱里：看到 Operation not permitted 就知道是边界，而不是命令写错了
      description: `${bash.description}命令运行在沙箱里：只能写项目目录；不能读 ~/.ssh 等凭据；${proxy ? `网络只能访问 ${options.allowedDomains!.join('、')}` : '没有网络'}。出现 Operation not permitted 是沙箱拦下的，不要想办法绕过，告诉用户需要什么权限。`,
      run: ({ command, ...rest }, signal) => {
        const wrapped = wrapCommand(command, policy, kind, profile, tmp);
        // mox 的 bash 不接受额外的环境变量，用 env 命令把它们带进沙箱
        const env = Object.entries(wrapped.env).map(([k, v]) => `${k}=${quote(v)}`).join(' ');
        return bash.run({ ...rest, command: `env ${env} ${wrapped.command}` }, signal);
      },
    });

    mox.on('shutdown', async () => { await proxy?.close(); });
  };
}

export default createSandboxMoxExtension();
