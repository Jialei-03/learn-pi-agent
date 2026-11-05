// mox 扩展：检查点与 /rewind（第 16 章）。
// 每次 write、edit、会改东西的 bash 执行之前，给工作目录拍一张快照（影子 git 仓库，见 store.ts）；
// /rewind 选一个检查点，把代码恢复到那次操作之前。mox 没有会话树，对话不会回退，所以恢复之后用一段系统提示告诉模型：磁盘上的现状变了。
// 加载顺序：每个扩展的 tool_call 都会被调用，所以放在权限扩展前后都能拍到快照。放在前面时，被权限扩展拒绝的调用也会留下一个检查点
// （恢复它不会改变任何东西）；放在后面，被拒绝的调用不会拍快照，因为一旦有扩展拒绝，后面的就不再被调用。
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import { decidePermission } from '../permissions/rules.ts';
import { CheckpointStore, type FileChange } from './store.ts';

const describe = (changes: FileChange[]) => changes.map(c => `${{ A: '恢复', M: '还原', D: '删除' }[c.status]} ${c.path}`).join('\n') || '没有文件变化';

export function createCheckpointMoxExtension(gitDir?: string) {
  return (mox: ExtensionApi) => {
    // 影子仓库默认放在 ~/.mox/checkpoints/<工作目录的哈希>
    const store = new CheckpointStore(mox.cwd, gitDir ?? join(homedir(), '.mox', 'checkpoints', createHash('sha256').update(mox.cwd).digest('hex').slice(0, 16)));
    const points: { commit: string; label: string }[] = [];
    let note = '';

    mox.on('tool_call', (name: string, args: Record<string, any>) => {
      if (!['write', 'edit', 'bash'].includes(name)) return;
      // 只读的命令不会改东西，不拍快照（判断复用第 14 章的规则引擎）
      if (name === 'bash' && decidePermission(name, args, { cwd: mox.cwd, mode: 'plan', rules: [] }).behavior === 'allow') return;
      const label = name === 'bash' ? `bash: ${String(args.command).replace(/\s+/g, ' ').slice(0, 50)}` : `${name} ${args.path}`;
      try {
        points.push({ commit: store.snapshot(label), label });
      } catch (error) {
        process.stderr.write(`[checkpoint] 创建失败：${(error as Error).message}\n`);
      }
      // 不能 return 任何东西：tool_call 处理器返回字符串就是拒绝这次调用
    });

    mox.registerCommand('rewind', async arg => {
      if (!points.length) return void process.stdout.write('还没有检查点\n');
      // 最新的在最前面。/rewind 3 直接选第 3 个，不带参数就列出来让用户选
      const items = points.map((p, i) => ({ ...p, n: i + 1, text: `${i + 1}. ${p.label}` })).reverse();
      const choice = Number(arg) ? items.find(p => p.n === Number(arg))?.text : await mox.ask('回到哪一次操作之前？', items.map(p => p.text));
      const point = items.find(p => p.text === choice);
      if (!point) return void process.stdout.write(`没有选中检查点。用法：/rewind <序号>\n${items.map(p => p.text).join('\n')}\n`);
      const { backup, changes } = store.restore(point.commit);
      // 恢复前的状态也记下来：/rewind 本身也能撤销
      points.push({ commit: backup, label: '（/rewind 之前的状态）' });
      note = `用户刚刚用 /rewind 把工作目录恢复到了「${point.label}」之前。对话里之前的修改有些已经不在磁盘上了，继续之前先重新读文件确认现状。`;
      process.stdout.write(`代码已恢复：\n${describe(changes)}\n`);
    });

    // 一次性的提示：下一次运行的系统提示里告诉模型磁盘变了
    mox.addSystemPrompt(() => { const text = note; note = ''; return text; });
  };
}

export default createCheckpointMoxExtension();
