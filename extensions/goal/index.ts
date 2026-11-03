// Pi 扩展：目标循环（第 18 章）。/goal "检查命令" 目标描述 —— Agent 会一直工作，直到检查命令成功。
// 挂在 agent_before_settle 上：这是 Pi 运行真正结束前的最后一个决策点，可以追加一条消息并要求继续（第 9、13 章）。
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { parseArgs } from '../../mox/src/skills.ts';
import { evaluate, type Goal } from './goal.ts';

export function createGoalExtension(options: { maxRounds?: number } = {}) {
  return (pi: ExtensionAPI) => {
    let goal: Goal | undefined;

    pi.registerCommand('goal', {
      description: '设定目标：/goal "检查命令" 目标描述。Agent 会一直工作到检查命令成功（退出码 0）；/goal off 取消',
      handler: async (args, ctx) => {
        if (args.trim() === 'off') { goal = undefined; ctx.ui.notify('已取消目标', 'info'); return; }
        const [check, ...rest] = parseArgs(args);
        if (!check) { ctx.ui.notify('用法：/goal "npm test" 修好所有失败的测试', 'warning'); return; }
        goal = { objective: rest.join(' ') || `让 \`${check}\` 通过`, check, maxRounds: options.maxRounds ?? 5, round: 0 };
        ctx.ui.setStatus('goal', `目标：${check}`);
        pi.sendUserMessage(`${goal.objective}\n\n（完成的标准：\`${check}\` 成功运行，退出码为 0。）`);
      },
    });

    pi.on('agent_before_settle', async (event, ctx) => {
      if (!goal) return;
      const step = await evaluate(goal, ctx.cwd);
      if (step.kind !== 'continue') {
        ctx.ui.notify(step.kind === 'done' ? `目标达成：\`${goal.check}\` 通过` : `目标循环停止：${step.reason}`, step.kind === 'done' ? 'info' : 'warning');
        ctx.ui.setStatus('goal', undefined);
        goal = undefined;
        return;
      }
      return { entries: [...event.entries, { type: 'custom_message' as const, customType: 'goal', content: step.message, display: true }], continue: true };
    });
  };
}

export default createGoalExtension();
