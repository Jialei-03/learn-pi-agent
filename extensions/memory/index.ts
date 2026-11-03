// Pi 扩展：长期记忆（第 10 章）。Pi 没有内置跨会话记忆，用一个扩展补上。
//
// 安装：pi -e ./extensions/memory/index.ts，或复制到 ~/.pi/agent/extensions/memory/
//
// - save_memory / forget_memory 两个工具
// - before_agent_start 时把记忆索引作为系统提示的一个“小节”放进去（会话中途变化时，Pi 只追加补丁，不破坏缓存）
// - 用户明确要求“记住”时直接生效；模型自己决定记的进入待确认列表，/memory approve 之后才生效
// - /memory 命令：列出、确认、删除
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { MEMORY_TYPES, MemoryStore, userAskedToRemember, type MemoryType } from './store.ts';

const projectSlug = (cwd: string) => cwd.replace(/^\//, '').replace(/[\\/:]/g, '-') || 'root';

export function createMemoryExtension(options: { dir?: string } = {}) {
  return function memoryExtension(pi: ExtensionAPI) {
    let store: MemoryStore | undefined;
    let lastPrompt = '';
    const getStore = (cwd: string) => (store ??= new MemoryStore(options.dir ?? join(homedir(), '.pi', 'agent', 'memory', projectSlug(cwd))));

    pi.on('before_agent_start', (event, ctx) => {
      if (event.messageType === 'user') lastPrompt = event.prompt;          // 由自定义消息触发的运行没有用户输入
      // 就地修改结构化的系统提示选项：Pi 会比较小节的变化，只把变化部分作为补丁追加（第 6 章）
      event.systemPromptOptions.sections.memory = getStore(ctx.cwd).promptSection();
      return undefined;
    });

    pi.registerTool({
      name: 'save_memory',
      label: 'save_memory',
      description: '保存一条跨会话的长期记忆。只保存以后的会话仍然有用、且无法从代码或 git 历史得到的信息。name 已存在时会覆盖更新。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '简短的英文标识，例如 package-manager' },
          description: { type: 'string', description: '一行摘要，会出现在记忆索引里' },
          type: { type: 'string', enum: Object.keys(MEMORY_TYPES), description: Object.entries(MEMORY_TYPES).map(([k, v]) => `${k}：${v}`).join('；') },
          content: { type: 'string', description: '记忆正文。feedback 和 project 类型请写明原因' },
        },
        required: ['name', 'description', 'type', 'content'],
      } as any,
      async execute(_id, params: { name: string; description: string; type: MemoryType; content: string }, _signal, _onUpdate, ctx) {
        const explicit = userAskedToRemember(lastPrompt);
        const confirmed = explicit || (ctx?.hasUI ? await ctx.ui.confirm('保存长期记忆？', `${params.name}：${params.description}\n\n${params.content}`) : false);
        const saved = getStore(ctx?.cwd ?? process.cwd()).save({
          ...params,
          status: confirmed ? 'active' : 'pending',
          source: explicit ? '用户在对话中要求记住' : confirmed ? '模型提议，用户在弹窗中确认' : '模型提议，等待用户确认',
        });
        const text = saved.status === 'active'
          ? `已保存记忆 ${saved.name}，从下一次运行开始生效。`
          : `已记录 ${saved.name}，但它需要用户确认（/memory approve ${saved.name}）后才会生效。`;
        return { content: [{ type: 'text', text }], details: saved };
      },
    });

    pi.registerTool({
      name: 'forget_memory',
      label: 'forget_memory',
      description: '删除一条已经过时或错误的长期记忆。',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } as any,
      async execute(_id, params: { name: string }, _s, _u, ctx) {
        getStore(ctx?.cwd ?? process.cwd()).forget(params.name);
        return { content: [{ type: 'text', text: `已删除记忆 ${params.name}。` }], details: {} };
      },
    });

    pi.registerCommand('memory', {
      description: '查看长期记忆：/memory、/memory approve <name>、/memory forget <name>',
      handler: async (args, ctx) => {
        const s = getStore(ctx.cwd);
        const [action, name] = args.trim().split(/\s+/);
        if (action === 'approve' && name) { s.setStatus(name, 'active'); ctx.ui.notify(`已确认记忆 ${name}`, 'info'); return; }
        if (action === 'forget' && name) { s.forget(name); ctx.ui.notify(`已删除记忆 ${name}`, 'info'); return; }
        const all = s.list();
        ctx.ui.notify(all.length ? all.map(m => `${m.status === 'pending' ? '⏳' : '✓'} ${m.name} — ${m.description}（${m.source}）`).join('\n') : '还没有任何记忆', 'info');
      },
    });
  };
}

export default createMemoryExtension();
