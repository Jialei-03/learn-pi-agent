// mox 版本的长期记忆扩展（第 10 章）：与 Pi 版本共用 store.ts，只是接入方式不同。
//
//   mox -e extensions/memory/mox.ts
//
// 用到了扩展接口的三个入口：
//   addSystemPrompt  把记忆索引追加在系统提示末尾，每次运行前重新从磁盘取值
//   registerTool     save_memory、forget_memory 两个工具
//   registerCommand  /memory：列出、确认（approve）、删除（forget），这是用户自己的入口
//
// 和 Pi 版本相比，mox 的接口更小，扩展里相应地做了取舍：
//   1. 没有“分节补丁”：系统提示是一整段字符串。记忆变化的那一次运行，缓存会失效一次（实验见 labs/ch10/cache.ts）
//   2. 工具函数看不到用户输入（没有 before_agent_start），所以没有“用户这次说了记住”这道关；
//      每次模型要保存、覆盖或删除，都用 mox.ask 当场问用户。没有终端时 ask 返回 undefined，按“没人确认”处理
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import { MEMORY_TYPES, MemoryStore, forgetFromModel, projectSlug, saveFromModel, type SaveParams } from './store.ts';

export function createMemoryMoxExtension(options: { dir?: string; print?: (text: string) => void } = {}) {
  return (mox: ExtensionApi) => {
    const store = new MemoryStore(options.dir ?? join(homedir(), '.mox', 'memory', projectSlug(mox.cwd)));
    const print = options.print ?? console.log;

    // #region inject-prompt
    // 每次运行前重新取值：另一个会话写的记忆、用户手动改的文件，下一次运行都能看到。
    // 追加在系统提示的末尾，让变化点尽量靠后，记忆之前的部分还能复用缓存
    mox.addSystemPrompt(() => `<memory>\n${store.promptSection()}\n</memory>`);
    // #endregion

    // #region save-tool
    mox.registerTool({
      name: 'save_memory',
      description: '保存一条跨会话的长期记忆。只保存以后的会话仍然有用、且无法从代码或 git 历史得到的信息。每次保存都会当场询问用户；name 已存在且已生效时，覆盖同样需要用户确认。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '简短的英文标识，例如 package-manager' },
          description: { type: 'string', description: '一行摘要，会出现在记忆索引里' },
          type: { type: 'string', enum: Object.keys(MEMORY_TYPES), description: Object.entries(MEMORY_TYPES).map(([k, v]) => `${k}：${v}`).join('；') },
          content: { type: 'string', description: '记忆正文。feedback 和 project 类型请写明原因' },
        },
        required: ['name', 'description', 'type', 'content'],
      },
      async run(args: SaveParams) {
        const overwrites = store.get(args.name)?.status === 'active';
        const reply = await mox.ask(`${overwrites ? '覆盖' : '保存'}长期记忆 ${args.name}？${args.description}\n${args.content}`, ['只记录，等我用 /memory approve 确认', '保存，立即生效']);
        const confirmed = reply === '保存，立即生效';          // 选项里把稳妥的“只记录”排在前面；其他任何回答（包括没有回答）都当作没确认
        const saved = saveFromModel(store, args, { explicit: false, confirmed });
        return saved.status === 'active'
          ? `已保存记忆 ${saved.name}，从下一次运行开始生效。`
          : `已记录 ${saved.name}，但它需要用户确认（/memory approve ${saved.name}）后才会生效。`;
      },
    });
    // #endregion

    // #region forget-tool
    mox.registerTool({
      name: 'forget_memory',
      description: '删除一条已经过时或错误的长期记忆。每次都会当场询问用户；用户不同意或没有终端时会被拒绝，请让用户运行 /memory forget。',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      async run({ name }: { name: string }) {
        const confirmed = (await mox.ask(`删除长期记忆 ${name}？`, ['保留', '删除'])) === '删除';
        forgetFromModel(store, name, { explicit: false, confirmed });
        return `已删除记忆 ${name}。`;
      },
    });
    // #endregion

    // #region memory-command
    // 命令的返回值 cli.ts 不会显示，要自己打印
    mox.registerCommand('memory', args => {
      const [action, name] = args.trim().split(/\s+/);
      if (action === 'approve' && name) { store.setStatus(name, 'active'); return print(`已确认记忆 ${name}`); }
      if (action === 'forget' && name) { store.forget(name); return print(`已删除记忆 ${name}`); }
      const all = store.list();
      print(all.length ? all.map(m => `${m.status === 'pending' ? '⏳' : '✓'} ${m.name} — ${m.description}（${m.source}）`).join('\n') : '还没有任何记忆');
    });
    // #endregion
  };
}

export default createMemoryMoxExtension();
