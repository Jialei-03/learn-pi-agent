// Pi 扩展：检查点与 /rewind（第 16 章）。
// 每次用户提问、Agent 动手之前，给工作目录拍一张快照，记录成会话里的一条自定义记录。
// /rewind 选一个检查点，可以恢复代码、恢复对话（第 7 章的会话树：回到那条记录，从那里开出新分支），或者两者都恢复。
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { CheckpointStore, type FileChange } from './store.ts';

export interface CheckpointOptions {
  /** 影子仓库放在哪；默认 ~/.pi/agent/checkpoints/<工作目录的哈希> */
  storeDir?: (ctx: ExtensionContext) => string;
}

const describe = (changes: FileChange[]) => changes.map(c => `${{ A: '恢复', M: '还原', D: '删除' }[c.status]} ${c.path}`).join('\n') || '没有文件变化';

export function createCheckpointExtension(options: CheckpointOptions = {}) {
  return (pi: ExtensionAPI) => {
    let store: CheckpointStore | undefined;

    pi.on('session_start', async (_event, ctx) => {
      const dir = options.storeDir?.(ctx) ?? join(getAgentDir(), 'checkpoints', createHash('sha256').update(ctx.cwd).digest('hex').slice(0, 16));
      store = new CheckpointStore(ctx.cwd, dir);
    });

    // 用户的提问进入循环之前拍快照。斜杠命令、扩展自己发出的消息不算
    pi.on('input', async (event, ctx) => {
      if (!store || event.source === 'extension' || event.text.startsWith('/')) return;
      try {
        const commit = store.snapshot(event.text.slice(0, 72));
        pi.appendEntry('checkpoint', { commit, prompt: event.text.slice(0, 80) });
      } catch (error) {
        ctx.ui.notify(`检查点创建失败：${(error as Error).message}`, 'warning');
      }
    });

    pi.registerCommand('rewind', {
      description: '回到之前某次提问之前：恢复代码、对话，或两者',
      handler: async (_args, ctx) => {
        const points = (ctx.sessionManager.getBranch() as any[]).filter(e => e.type === 'custom' && e.customType === 'checkpoint');
        if (!store || points.length === 0) { ctx.ui.notify('还没有检查点', 'info'); return; }
        const labels = points.map((p, i) => `${i + 1}. ${p.data.prompt}`);
        const picked = await ctx.ui.select('回到哪一次提问之前？', labels);
        const point = points[labels.indexOf(picked ?? '')];
        if (!point) return;
        const what = await ctx.ui.select('恢复什么？', ['代码和对话', '只恢复代码', '只恢复对话']);
        if (!what) return;
        if (what !== '只恢复对话') {
          const { backup, changes } = store.restore(point.data.commit);
          // 恢复前的状态也记下来：恢复本身也能撤销
          pi.appendEntry('checkpoint', { commit: backup, prompt: `（/rewind 之前的状态）` });
          ctx.ui.notify(`代码已恢复：\n${describe(changes)}`, 'info');
        }
        if (what !== '只恢复代码') await ctx.navigateTree(point.id);
      },
    });
  };
}

export default createCheckpointExtension();
