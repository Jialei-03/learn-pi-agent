// mox 版本的长期记忆扩展（第 10 章）：与 Pi 版本共用 store.ts，只是接入方式不同。
//
//   node mox/src/cli.ts --ext extensions/memory/mox.ts
//
// 和 Pi 版本相比，mox 少了三样东西，扩展里相应地做了取舍：
//   1. mox 的系统提示是一整段字符串，没有“分节补丁”：记忆索引追加在末尾，记忆变化的那一次运行会让缓存失效（实验见 labs/ch10/cache.ts）
//   2. 工具拿不到界面（没有 ctx.ui.confirm）：模型自己决定记的一律进待确认列表，用户用 /memory approve 确认
//   3. 没有 forget_memory 工具：模型不能删记忆，删除只有用户的 /memory forget 一个入口
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MoxExtensionAPI } from '../../mox/src/extensions.ts';
import { MEMORY_TYPES, MemoryStore, projectSlug, saveFromModel, userAskedToRemember, type SaveParams } from './store.ts';

export function createMemoryMoxExtension(options: { dir?: string } = {}) {
  return (api: MoxExtensionAPI) => {
    let store: MemoryStore | undefined;
    let lastPrompt = '';   // 用户在这次运行里说的话：说了“记住”，保存请求才直接生效
    const getStore = (cwd: string) => (store ??= new MemoryStore(options.dir ?? join(homedir(), '.mox', 'memory', projectSlug(cwd))));

    // #region inject-prompt
    api.on('before_agent_start', (event, ctx) => {
      lastPrompt = event.prompt;
      // 追加在系统提示的末尾：记忆不变时，整段系统提示逐字相同，前缀稳定
      const memory = getStore(ctx.cwd).promptSection();
      return { systemPrompt: `${event.systemPrompt}\n\n<memory>\n${memory}\n</memory>` };
    });
    // #endregion

    // #region save-tool
    api.registerTool({
      name: 'save_memory',
      description: '保存一条跨会话的长期记忆。只保存以后仍然有用、且无法从代码或 git 历史得到的信息。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, description: { type: 'string' }, type: { type: 'string', enum: Object.keys(MEMORY_TYPES) }, content: { type: 'string' } },
        required: ['name', 'description', 'type', 'content'],
      },
      execute(args) {
        const explicit = userAskedToRemember(lastPrompt);
        // 没有弹窗可以问：confirmed 就等于 explicit。同名的已生效记忆不会被没人批准的写入覆盖（抛错，模型会看到错误结果）
        const saved = saveFromModel(getStore(process.cwd()), args as SaveParams, { explicit, confirmed: explicit });
        return saved.status === 'active' ? `已保存记忆 ${saved.name}。` : `已记录 ${saved.name}，等待用户确认（/memory approve ${saved.name}）。`;
      },
    });
    // #endregion

    // #region memory-command
    api.registerCommand('memory', {
      description: '列出、确认或删除长期记忆',
      handler(args, ctx) {
        const memories = getStore(ctx.cwd);
        const [action, name] = args.trim().split(/\s+/);
        if (action === 'approve' && name) return memories.setStatus(name, 'active');
        if (action === 'forget' && name) return memories.forget(name);
        for (const m of memories.list()) console.log(`${m.status === 'pending' ? '⏳' : '✓'} ${m.name} — ${m.description}（${m.source}）`);
      },
    });
    // #endregion
  };
}

export default createMemoryMoxExtension();
