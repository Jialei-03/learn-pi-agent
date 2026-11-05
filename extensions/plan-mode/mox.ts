// mox 扩展：计划模式（第 16 章）。先只读地调研、写出计划，用户批准之后才动手。
//   /mode plan 进入计划模式；模型用 exit_plan_mode 提交计划，用户批准后回到普通模式；/mode normal 手动退出。
// 三件事各用一个接口：registerCommand 切换，on('tool_call') 在计划模式里拦下一切非只读的调用，addSystemPrompt 告诉模型现在的规则。
// 加载顺序：每个扩展的 tool_call 都会被调用，拒绝优先，所以顺序不影响安全。但建议排在权限扩展（第 14 章）之前：
// 权限扩展先问用户“允许吗？”，计划模式随后还是拒绝，用户就被白问了一次。
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import { decidePermission } from '../permissions/rules.ts';

const PLAN_PROMPT = `<plan-mode>
现在处于计划模式：只能读文件、运行只读命令来调研，不能修改任何东西。
弄清楚需求和现状后，写出一份具体的计划（要改哪些文件、怎么改、怎么验证），然后调用 exit_plan_mode 提交给用户审批。
不要在审批之前尝试修改文件。如果 exit_plan_mode 的结果说用户已批准，计划模式就结束了，即使这段说明还在，也以那条结果为准。
</plan-mode>`;
/** 计划模式下也可以用的工具：它们只改变 Agent 自己的状态；子 Agent 的每个调用会单独经过下面的检查 */
const ALWAYS_ALLOWED = new Set(['exit_plan_mode', 'todo_write', 'task']);

export function createPlanModeMoxExtension() {
  return (mox: ExtensionApi) => {
    let active = false;
    const say = () => process.stdout.write(`${active ? '计划模式：只能读，提交计划经批准后才能修改' : '普通模式'}\n`);

    mox.registerCommand('mode', arg => {
      const next = String(arg).trim();
      active = next === 'plan' ? true : next === 'normal' ? false : !active;   // 不带参数就切换
      say();
    });

    // 只读检查复用第 14 章的规则引擎：plan 模式下只有只读操作能通过
    mox.on('tool_call', (name: string, args: Record<string, unknown>) => {
      if (!active || ALWAYS_ALLOWED.has(name)) return;
      const d = decidePermission(name, args, { cwd: mox.cwd, mode: 'plan', rules: [] });
      if (d.behavior !== 'allow') return `${d.reason}。请先调用 exit_plan_mode 提交计划。`;
    });

    mox.addSystemPrompt(() => (active ? PLAN_PROMPT : ''));

    // mox 的工具列表在注册之后就固定了，不能像 Pi 那样只在计划模式里才出现；不在计划模式时调用它只会得到一句提示
    mox.registerTool({
      name: 'exit_plan_mode',
      description: '计划模式下，计划写好后调用它，把计划交给用户审批。用户批准后才能开始修改文件。不在计划模式时不要调用。',
      parameters: { type: 'object', properties: { plan: { type: 'string', description: '要执行的计划（Markdown）：改哪些文件、怎么改、怎么验证' } }, required: ['plan'] },
      run: async ({ plan }: { plan: string }) => {
        if (!active) return '当前不在计划模式，不需要审批。';
        const choice = await mox.ask(`批准这个计划吗？\n\n${plan}`, ['批准', '不批准']);
        if (choice === undefined) return '当前没有终端，用户无法审批。请把计划作为最终回答输出，然后结束。';
        if (choice !== '批准') return '用户没有批准这个计划。先不要修改任何文件：向用户询问需要怎么改，或者继续调研后重新提交。';
        active = false;
        return '用户批准了计划。现在可以修改文件了：按计划执行，用 todo_write 跟踪进度。';
      },
    });
  };
}

export default createPlanModeMoxExtension();
