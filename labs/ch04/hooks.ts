// 第 4 章实验：执行前拦截、执行后改写。
//   node labs/ch04/hooks.ts
// beforeToolCall：拦下会删除根目录的命令，工具函数根本不会被调用。
// afterToolCall：把命令输出里的密钥隐去，模型永远看不到原文。
import type { AgentTool, ToolHooks } from '../../mox/src/tools.ts';
import type { Script } from '../../mox/src/providers/scripted.ts';
import { runMox, runPi, toolResults } from '../shared/harness.ts';

const executed: string[] = [];
const bash: AgentTool = {
  name: 'bash', description: '执行 shell 命令', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  execute({ command }) {
    executed.push(command);                       // 假的 shell：只记录，不真正执行
    if (command === 'cat .env') return 'DATABASE_URL=postgres://localhost/mox\nOPENAI_API_KEY=sk-live-9f8e7d6c5b4a3210';
    return '（执行完成）';
  },
};

const hooks: ToolHooks = {
  beforeToolCall(call, args) {
    if (call.name === 'bash' && /\brm\s+-rf\s+\/(\s|$)/.test(String(args.command))) {
      return { block: true, reason: '拒绝执行：这条命令会删除根目录。请只删除项目内的目录。' };
    }
  },
  afterToolCall(_call, _args, result) {
    const redacted = result.content.replace(/sk-[A-Za-z0-9-]{8,}/g, 'sk-***');
    if (redacted !== result.content) return { content: redacted };
  },
};

const script: Script = (_ctx, n) => {
  if (n === 1) return { toolCalls: [{ name: 'bash', arguments: { command: 'rm -rf build && rm -rf /' } }] };
  if (n === 2) return { toolCalls: [{ name: 'bash', arguments: { command: 'cat .env' } }] };
  return { text: '已经查看了配置。' };
};

for (const [label, run] of [['mox', runMox], ['Pi', runPi]] as const) {
  executed.length = 0;
  const report = await run({ prompt: '清理一下并看看配置', script, tools: [bash], hooks });
  const [blocked, env] = toolResults(report.messages);
  console.log(`━━ ${label} ━━`);
  console.log(`真正执行过的命令：${executed.join('；') || '（无）'}`);
  console.log(`第一次调用，模型看到：${blocked.content}（isError=${blocked.isError}）`);
  console.log(`第二次调用，模型看到：${env.content.replace('\n', ' ⏎ ')}\n`);
}
