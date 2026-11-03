// Pi 扩展：让 bash 工具在操作系统沙箱里运行（第 15 章）。
// 用 Pi 的 spawnHook：工具照常收到模型写的命令，只在启动进程的那一刻把它包进 sandbox-exec / bwrap。
// 只管 bash：read、write、edit 运行在 Pi 进程里，由第 14 章的权限规则管。要连它们一起隔离，见 Pi 的 Gondolin 示例。
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { createBashToolDefinition, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { defaultDenyRead, defaultDenyWrite, detectSandbox, seatbeltProfile, wrapCommand, type SandboxPolicy } from './policy.ts';
import { startProxy, type ProxyDecision } from './proxy.ts';

export interface SandboxOptions {
  /** 允许访问的域名；不给就完全断网 */
  allowedDomains?: string[];
  /** 额外禁止读取的路径（相对路径以工作目录为基准），会加在默认的凭据目录之后 */
  denyRead?: string[];
  /** 额外可写的目录 */
  writable?: string[];
  onProxyDecision?: (d: ProxyDecision) => void;
}

export function createSandboxExtension(options: SandboxOptions = {}) {
  return (pi: ExtensionAPI) => {
    let closeProxy: (() => Promise<void>) | undefined;

    pi.on('session_start', async (_event, ctx) => {
      const kind = detectSandbox();
      if (!kind) {
        ctx.ui.notify('没有可用的沙箱（macOS 需要 sandbox-exec，Linux 需要 bwrap），bash 命令将不受限制地运行', 'warning');
        return;
      }
      const proxy = options.allowedDomains?.length ? await startProxy(options.allowedDomains, options.onProxyDecision) : undefined;
      closeProxy = proxy?.close;
      const work = mkdtempSync(join(tmpdir(), 'pi-sandbox-'));
      const tmp = join(work, 'tmp');
      const policy: SandboxPolicy = {
        writable: [ctx.cwd, tmp, ...(options.writable ?? [])],
        denyWrite: defaultDenyWrite(ctx.cwd),
        denyRead: [...defaultDenyRead(), ...(options.denyRead ?? []).map(p => (isAbsolute(p) ? p : resolve(ctx.cwd, p)))],
        network: proxy ? 'proxy' : 'none',
        proxyPort: proxy?.port,
      };
      mkdirSync(tmp);
      writeFileSync(join(work, 'profile.sb'), seatbeltProfile(policy));
      // 用同名工具替换内置的 bash：参数、输出、截断都和原来一样，只是进程在沙箱里启动
      pi.registerTool(createBashToolDefinition(ctx.cwd, {
        spawnHook: context => {
          const wrapped = wrapCommand(context.command, policy, kind, join(work, 'profile.sb'), tmp);
          return { ...context, command: wrapped.command, env: { ...context.env, ...wrapped.env } };
        },
      }));
      ctx.ui.setStatus('sandbox', `沙箱：${kind}${proxy ? `，网络白名单 ${options.allowedDomains!.join(', ')}` : '，无网络'}`);
    });

    pi.on('session_shutdown', async () => { await closeProxy?.(); });
  };
}

export default createSandboxExtension();
