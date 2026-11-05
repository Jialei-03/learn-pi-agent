// mox 扩展：目标循环（第 18 章）。设定一条检查命令之后，Agent 每次准备停下，扩展都运行一遍检查：
// 通过就让它停；不通过，就把检查的输出作为“下一句话”交回去，cli.ts 的 while 循环会让它接着干。
// 设定目标有两种方式：交互模式下 /goal "检查命令" 目标描述；非交互（mox -p）没有命令，用环境变量 MOX_GOAL="检查命令"。
// 用法：mox -e extensions/goal/mox.ts
import type { Extension } from '../../mox/src/extensions.ts';
import { evaluate, parseArgs, type Goal } from './goal.ts';

export function createGoalMoxExtension({ maxRounds = 5, check = process.env.MOX_GOAL }: { maxRounds?: number; check?: string } = {}): Extension {
  return mox => {
    const say = (text: string) => process.stdout.write(text);
    let goal: Goal | undefined;
    const setGoal = (command: string, objective?: string) => {
      goal = { objective: objective || `让 \`${command}\` 通过`, check: command, maxRounds, round: 0 };
      say(`目标已设定：${command}\n`);
    };
    if (check) setGoal(check);

    mox.registerCommand('goal', args => {
      if (args.trim() === 'off') { goal = undefined; return say('目标已取消\n'); }
      const [command, ...rest] = parseArgs(args);
      if (command) setGoal(command, rest.join(' '));
      else say('用法：/goal "npm test" 修好测试；/goal off 取消\n');
    });

    // Agent 准备停下：运行检查。返回字符串 = 下一句话，Agent 继续；不返回 = 让它停
    mox.on('agent_end', async () => {
      if (!goal) return;
      const step = await evaluate(goal, mox.cwd);
      if (step.kind === 'continue') return step.message;
      say(step.kind === 'done' ? `\n目标达成：${goal.check} 通过\n` : `\n目标循环停止：${step.reason}\n`);
      goal = undefined;
    });
  };
}

export default createGoalMoxExtension();
