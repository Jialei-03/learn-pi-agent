// mox 扩展：让 bash 命令在操作系统沙箱里运行（第 15 章）。
// mox 没有 spawnHook，这里用另一种办法：在 tool_call 里直接改写 bash 的 command 参数。
// 模型的那条工具调用不受影响（第 4 章：参数是复制出来的），但这个扩展要最后加载——权限扩展应该看到改写前的命令。
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { MoxExtension } from '../../mox/src/extensions.ts';
import { defaultDenyRead, defaultDenyWrite, detectSandbox, seatbeltProfile, wrapCommand, type SandboxPolicy } from './policy.ts';
import { startProxy } from './proxy.ts';
import type { SandboxOptions } from './index.ts';

export function createSandboxMoxExtension(options: SandboxOptions = {}): MoxExtension {
  return async api => {
    const kind = detectSandbox();
    if (!kind) { process.stderr.write('[sandbox] 没有可用的沙箱，bash 命令将不受限制地运行\n'); return; }
    const proxy = options.allowedDomains?.length ? await startProxy(options.allowedDomains, options.onProxyDecision) : undefined;
    const work = mkdtempSync(join(tmpdir(), 'mox-sandbox-'));
    const tmp = join(work, 'tmp');
    mkdirSync(tmp);
    let policy: SandboxPolicy | undefined;

    api.on('session_start', ({ cwd }) => {
      policy = {
        writable: [cwd, tmp, ...(options.writable ?? [])],
        denyWrite: defaultDenyWrite(cwd),
        denyRead: [...defaultDenyRead(), ...(options.denyRead ?? []).map(p => (isAbsolute(p) ? p : resolve(cwd, p)))],
        network: proxy ? 'proxy' : 'none',
        proxyPort: proxy?.port,
      };
      writeFileSync(join(work, 'profile.sb'), seatbeltProfile(policy));
    });

    api.on('tool_call', event => {
      if (event.toolName !== 'bash' || !policy) return;
      const wrapped = wrapCommand(String(event.input.command), policy, kind, join(work, 'profile.sb'), tmp);
      // mox 的 bash 工具不接受额外的环境变量，就用 env 命令带进去
      const env = Object.entries(wrapped.env).map(([k, v]) => `${k}='${v}'`).join(' ');
      event.input.command = `env ${env} ${wrapped.command}`;
    });

    api.on('session_shutdown', async () => { await proxy?.close(); });
  };
}

export default createSandboxMoxExtension();
