// Pi 扩展：长期记忆（第 10 章）。Pi 没有内置跨会话记忆，用一个扩展补上。
//
// 安装：pi -e ./extensions/memory/index.ts，或复制到 ~/.pi/agent/extensions/memory/
//
// - save_memory / forget_memory 两个工具
// - before_agent_start 时把记忆索引作为系统提示的一个“小节”放进去（会话中途变化时，Pi 只追加补丁，不破坏缓存）
// - 用户明确要求“记住”时直接生效；模型自己决定记的进入待确认列表，/memory approve 之后才生效
// - 模型想覆盖已生效的记忆、或者删除记忆，同样需要用户批准（说了“忘掉”，或在弹窗里确认）
// - /memory 命令：列出、确认、删除。这是用户自己的入口，不经过上面的批准规则
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  MEMORY_TYPES, MemoryStore, forgetFromModel, projectSlug, saveFromModel, userAskedToForget, userAskedToRemember,
  type SaveParams,
} from './store.ts';

export function createMemoryExtension(options: { dir?: string } = {}) {
  return function memoryExtension(pi: ExtensionAPI) {
    let store: MemoryStore | undefined;
    let lastPrompt = '';   // 用户在这次运行里说的话；决定模型的保存 / 删除请求要不要走确认
    const getStore = (cwd: string) => (store ??= new MemoryStore(options.dir ?? join(homedir(), '.pi', 'agent', 'memory', projectSlug(cwd))));

    // #region inject-section
    pi.on('before_agent_start', (event, ctx) => {
      if (event.messageType === 'user') lastPrompt = event.prompt;          // 由自定义消息触发的运行没有用户输入
      // 就地修改结构化的系统提示选项：Pi 会比较小节的变化，只把变化部分作为补丁追加（第 6 章）
      event.systemPromptOptions.sections.memory = getStore(ctx.cwd).promptSection();
      return undefined;
    });
    // #endregion

    pi.registerTool({
      name: 'save_memory',
      label: 'save_memory',
      description: '保存一条跨会话的长期记忆。只保存以后的会话仍然有用、且无法从代码或 git 历史得到的信息。name 已存在且已生效时，覆盖需要用户确认。',
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
      // #region save-gate
      async execute(_id, params: SaveParams, _signal, _onUpdate, ctx) {
        const memories = getStore(ctx?.cwd ?? process.cwd());
        const overwrites = memories.get(params.name)?.status === 'active';
        const explicit = userAskedToRemember(lastPrompt);                    // 用户这次说了“记住”
        const confirmed = explicit || (ctx?.hasUI                            // 或者用户在弹窗里点了确认；没有界面就当作没人确认
          ? await ctx.ui.confirm(overwrites ? '覆盖长期记忆？' : '保存长期记忆？', `${params.name}：${params.description}\n\n${params.content}`)
          : false);
        const saved = saveFromModel(memories, params, { explicit, confirmed });
        const text = saved.status === 'active'
          ? `已保存记忆 ${saved.name}，从下一次运行开始生效。`
          : `已记录 ${saved.name}，但它需要用户确认（/memory approve ${saved.name}）后才会生效。`;
        return { content: [{ type: 'text', text }], details: saved };
      },
      // #endregion
    });

    pi.registerTool({
      name: 'forget_memory',
      label: 'forget_memory',
      description: '删除一条已经过时或错误的长期记忆。需要用户批准：用户让你忘掉，或用户在弹窗里确认；否则会被拒绝，请让用户运行 /memory forget。',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } as any,
      // #region forget-gate
      async execute(_id, params: { name: string }, _signal, _onUpdate, ctx) {
        const memories = getStore(ctx?.cwd ?? process.cwd());
        const explicit = userAskedToForget(lastPrompt);
        const confirmed = explicit || (ctx?.hasUI ? await ctx.ui.confirm('删除长期记忆？', params.name) : false);
        forgetFromModel(memories, params.name, { explicit, confirmed });
        return { content: [{ type: 'text', text: `已删除记忆 ${params.name}。` }], details: {} };
      },
      // #endregion
    });

    pi.registerCommand('memory', {
      description: '查看长期记忆：/memory、/memory approve <name>、/memory forget <name>',
      handler: async (args, ctx) => {
        const memories = getStore(ctx.cwd);
        const [action, name] = args.trim().split(/\s+/);
        if (action === 'approve' && name) { memories.setStatus(name, 'active'); ctx.ui.notify(`已确认记忆 ${name}`, 'info'); return; }
        if (action === 'forget' && name) { memories.forget(name); ctx.ui.notify(`已删除记忆 ${name}`, 'info'); return; }
        const all = memories.list();
        ctx.ui.notify(all.length ? all.map(m => `${m.status === 'pending' ? '⏳' : '✓'} ${m.name} — ${m.description}（${m.source}）`).join('\n') : '还没有任何记忆', 'info');
      },
    });
  };
}

export default createMemoryExtension();
