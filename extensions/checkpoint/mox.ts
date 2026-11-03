// mox 扩展：检查点（第 16 章）。每次提问前拍快照；/rewind 选一个检查点恢复代码。
// mox 的扩展不能导航会话树，对话部分用 mox 自带的 /tree 和 /branch（第 7 章）。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MoxExtension } from '../../mox/src/extensions.ts';
import { CheckpointStore } from './store.ts';

export function createCheckpointMoxExtension(gitDir = join(mkdtempSync(join(tmpdir(), 'mox-checkpoints-')), 'shadow.git')): MoxExtension {
  return api => {
    let store: CheckpointStore | undefined;
    const points: { commit: string; prompt: string }[] = [];
    api.on('session_start', ({ cwd }) => { store = new CheckpointStore(cwd, gitDir); });
    api.on('input', ({ text }) => {
      if (store && !text.startsWith('/')) points.push({ commit: store.snapshot(text.slice(0, 72)), prompt: text.slice(0, 60) });
    });
    api.registerCommand('rewind', {
      description: '把代码恢复到某次提问之前',
      handler: async (_args, ctx) => {
        if (!store || !points.length) { process.stdout.write('还没有检查点\n'); return; }
        const labels = points.map((p, i) => `${i + 1}. ${p.prompt}`);
        const picked = ctx.select ? await ctx.select('回到哪一次提问之前？', labels) : undefined;
        const point = points[labels.indexOf(picked ?? '')];
        if (!point) return;
        const { changes } = store.restore(point.commit);
        process.stdout.write(`代码已恢复（${changes.length} 个文件）。对话可以用 /tree 和 /branch 回到那次提问之前。\n`);
      },
    });
  };
}

export default createCheckpointMoxExtension();
