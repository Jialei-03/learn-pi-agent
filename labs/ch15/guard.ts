// 一条“看起来很合理”的规则：bash 命令里出现 rm 就拒绝。Mox-agent 的 README 里就是这个例子。
//   mox -e labs/ch15/guard.ts
import type { ExtensionApi } from '../../mox/src/extensions.ts';

export default (mox: ExtensionApi) => {
  mox.on('tool_call', (name: string, args: { command?: string }) => (name === 'bash' && /\brm\b/.test(args.command ?? '') ? '不允许删除文件' : undefined));
};
