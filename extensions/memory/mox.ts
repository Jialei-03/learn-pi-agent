// mox 版本的长期记忆扩展（第 10 章）：与 Pi 版本共用 store.ts。
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MoxExtensionAPI } from '../../mox/src/extensions.ts';
import { MEMORY_TYPES, MemoryStore, userAskedToRemember, type MemoryType } from './store.ts';

export function createMemoryMoxExtension(options: { dir?: string } = {}) {
  return (api: MoxExtensionAPI) => {
    let store: MemoryStore | undefined;
    let lastPrompt = '';
    const getStore = (cwd: string) => (store ??= new MemoryStore(options.dir ?? join(homedir(), '.mox', 'memory', cwd.replace(/^\//, '').replace(/[\\/:]/g, '-'))));
    // mox 的系统提示没有分节补丁机制，这里把记忆追加在末尾：记忆不变时前缀依然稳定
    api.on('before_agent_start', (e, ctx) => { lastPrompt = e.prompt; return { systemPrompt: `${e.systemPrompt}\n\n<memory>\n${getStore(ctx.cwd).promptSection()}\n</memory>` }; });
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
        const saved = getStore(process.cwd()).save({ ...(args as { name: string; description: string; type: MemoryType; content: string }), status: explicit ? 'active' : 'pending', source: explicit ? '用户在对话中要求记住' : '模型提议，等待用户确认' });
        return saved.status === 'active' ? `已保存记忆 ${saved.name}。` : `已记录 ${saved.name}，等待用户确认（/memory approve ${saved.name}）。`;
      },
    });
    api.registerCommand('memory', {
      description: '列出、确认或删除长期记忆',
      handler(args, ctx) {
        const s = getStore(ctx.cwd);
        const [action, name] = args.trim().split(/\s+/);
        if (action === 'approve' && name) return s.setStatus(name, 'active');
        if (action === 'forget' && name) return s.forget(name);
        for (const m of s.list()) console.log(`${m.status === 'pending' ? '⏳' : '✓'} ${m.name} — ${m.description}（${m.source}）`);
      },
    });
  };
}

export default createMemoryMoxExtension();
