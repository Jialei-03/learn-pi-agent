// mox 扩展：目标循环（第 18 章）。/goal "检查命令" 设定目标，之后的任务会一直做到检查通过。挂在 before_settle 上。
import type { MoxExtension } from '../../mox/src/extensions.ts';
import { parseArgs } from '../../mox/src/skills.ts';
import { evaluate, type Goal } from './goal.ts';

export function createGoalMoxExtension(maxRounds = 5): MoxExtension {
  return api => {
    let goal: Goal | undefined;
    api.registerCommand('goal', {
      description: '设定目标：/goal "检查命令" 目标描述；/goal off 取消',
      handler: args => {
        if (args.trim() === 'off') { goal = undefined; return; }
        const [check, ...rest] = parseArgs(args);
        if (check) goal = { objective: rest.join(' ') || `让 \`${check}\` 通过`, check, maxRounds, round: 0 };
        process.stdout.write(goal ? `目标已设定：${goal.check}。现在描述要做的事。\n` : '用法：/goal "npm test" 修好测试\n');
      },
    });
    api.on('before_settle', async (_event, ctx) => {
      if (!goal) return;
      const step = await evaluate(goal, ctx.cwd);
      if (step.kind === 'continue') return { followUp: step.message };
      process.stdout.write(step.kind === 'done' ? `\n目标达成：${goal.check} 通过\n` : `\n目标循环停止：${step.reason}\n`);
      goal = undefined;
    });
  };
}

export default createGoalMoxExtension();
