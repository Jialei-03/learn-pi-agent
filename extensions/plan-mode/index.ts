// Pi 扩展：计划模式（第 16 章）。先只读地调研、写出计划，用户批准之后才动手。
// 和 Pi 官方示例（examples/extensions/plan-mode）的不同：计划通过 exit_plan_mode 工具提交，而不是从回答里解析 “Plan:” 文本——
// 工具调用是结构化的、模型明确表示“我写完了”的信号；解析文本则要猜模型的格式。这也是 Claude Code 的做法。
import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { decidePermission } from '../permissions/rules.ts';

const PLAN_PROMPT = `<plan-mode>
现在处于计划模式：只能读文件、运行只读命令来调研，不能修改任何东西。
弄清楚需求和现状后，写出一份具体的计划（要改哪些文件、怎么改、怎么验证），然后调用 exit_plan_mode 提交给用户审批。
不要在审批之前尝试修改文件。
</plan-mode>`;
/** 计划模式下也可以用的工具：它们只改变 Agent 自己的状态 */
const ALWAYS_ALLOWED = new Set(['exit_plan_mode', 'todo_write']);

export function createPlanModeExtension() {
  return (pi: ExtensionAPI) => {
    let active = false;
    const setActive = (on: boolean, ctx: ExtensionContext) => {
      active = on;
      // exit_plan_mode 只在计划模式下出现在模型的工具列表里
      const tools = pi.getActiveTools().filter(t => t !== 'exit_plan_mode');
      pi.setActiveTools(on ? [...tools, 'exit_plan_mode'] : tools);
      pi.appendEntry('plan-mode', { active: on });
      // 装了第 14 章的权限扩展时，让它也切到 plan 模式：非只读的调用直接拒绝，不会先弹一个确认框
      pi.events.emit('permissions:set-mode', on ? 'plan' : 'default');
      ctx.ui.setStatus('plan-mode', on ? '⏸ 计划模式' : undefined);
    };

    pi.registerTool({
      name: 'exit_plan_mode',
      label: 'exit_plan_mode',
      description: '计划模式下，计划写好后调用它，把计划交给用户审批。用户批准后才能开始修改文件。',
      parameters: Type.Object({ plan: Type.String({ description: '要执行的计划（Markdown）：改哪些文件、怎么改、怎么验证' }) }),
      defaultActive: false,
      annotations: { readOnlyHint: true },
      async execute(_id, { plan }, _signal, _onUpdate, ctx) {
        const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], details: undefined });
        if (!active) return text('当前不在计划模式，不需要审批。');
        if (!ctx.hasUI) return text('当前没有界面，用户无法审批。请把计划作为最终回答输出，然后结束。');
        const choice = await ctx.ui.select(`批准这个计划吗？\n\n${plan}`, ['批准，并自动接受编辑', '批准，编辑逐个确认', '不批准，继续规划']);
        if (choice?.startsWith('批准')) {
          setActive(false, ctx);
          pi.events.emit('permissions:set-mode', choice === '批准，并自动接受编辑' ? 'acceptEdits' : 'default');
          return text('用户批准了计划。现在可以修改文件了：按计划执行，用 todo_write 跟踪进度。');
        }
        const feedback = await ctx.ui.input('计划需要怎么改？');
        return text(`用户没有批准这个计划。${feedback ? `意见：${feedback}` : ''}请继续调研并修改计划，然后重新提交。`);
      },
    });

    pi.registerCommand('plan', {
      description: '进入或退出计划模式（只读调研，计划经批准后才修改）',
      handler: async (_args, ctx) => { setActive(!active, ctx); ctx.ui.notify(active ? '已进入计划模式' : '已退出计划模式', 'info'); },
    });

    // 只读检查复用第 14 章的规则引擎：plan 模式下只有只读操作能通过
    pi.on('tool_call', async (event, ctx) => {
      if (!active || ALWAYS_ALLOWED.has(event.toolName)) return;
      const d = decidePermission(event.toolName, event.input as Record<string, unknown>, { cwd: ctx.cwd, mode: 'plan', rules: [] });
      if (d.behavior !== 'allow') return { block: true, reason: `${d.reason}。请先调用 exit_plan_mode 提交计划。` };
    });

    pi.on('before_agent_start', async event => {
      if (active && event.messageType === 'user') return { message: { customType: 'plan-mode', content: PLAN_PROMPT, display: false } };
    });

    // 状态记在会话里：恢复会话、切换分支后，计划模式的开关跟着回到当时的状态
    const restore = (ctx: ExtensionContext) => {
      const last = ctx.sessionManager.getBranch().filter((e: any) => e.type === 'custom' && e.customType === 'plan-mode').pop() as { data?: { active: boolean } } | undefined;
      active = last?.data?.active ?? false;
      ctx.ui.setStatus('plan-mode', active ? '⏸ 计划模式' : undefined);
    };
    pi.on('session_start', async (_e, ctx) => restore(ctx));
    pi.on('session_tree', async (_e, ctx) => restore(ctx));
  };
}

export default createPlanModeExtension();
