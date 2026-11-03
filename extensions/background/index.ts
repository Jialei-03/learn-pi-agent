// Pi 扩展：后台命令（第 18 章）。三个工具：bash_background 启动，bash_output 看新输出，bash_kill 结束。
// 命令结束时，扩展发一条消息给 Agent：正在工作就排在当前任务之后，空闲就开始新的一轮——模型不需要反复轮询。
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { BackgroundJobs, describeJob } from './jobs.ts';

const tail = (text: string, n = 4000) => (text.length > n ? `…（前面省略 ${text.length - n} 个字符）\n${text.slice(-n)}` : text);

export function createBackgroundExtension() {
  return (pi: ExtensionAPI) => {
    let jobs: BackgroundJobs | undefined;
    const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], details: undefined, ...(isError ? { isError } : {}) });

    let closed = false;
    pi.on('session_start', async (_e, ctx) => {
      jobs = new BackgroundJobs(ctx.cwd);
      jobs.onExit = job => {
        if (closed) return;                       // 会话已经结束：不再往一个不存在的会话里发消息
        const { text: rest } = jobs!.read(job.id)!;
        pi.sendMessage(
          { customType: 'background-exit', content: `后台命令 ${describeJob(job)}\n最后的输出：\n${tail(rest || '（没有新的输出）', 2000)}`, display: true },
          { deliverAs: 'followUp', triggerTurn: true },
        );
      };
    });
    pi.on('session_shutdown', async () => { closed = true; jobs?.killAll(); });

    pi.registerTool({
      name: 'bash_background',
      label: 'bash_background',
      description: '在后台启动一个长时间运行的命令（开发服务器、监听模式的测试、耗时的构建），立即返回编号。用 bash_output 查看输出，用 bash_kill 结束。命令结束时你会收到通知，不需要反复查看。',
      parameters: Type.Object({ command: Type.String() }),
      async execute(_id, { command }) {
        const job = jobs!.start(command);
        return text(`已在后台启动 #${job.id}。`);
      },
    });
    pi.registerTool({
      name: 'bash_output',
      label: 'bash_output',
      description: '查看后台命令自上次查看以来的新输出和当前状态。',
      parameters: Type.Object({ id: Type.Number() }),
      async execute(_id, { id }) {
        const r = jobs!.read(id);
        if (!r) return text(`没有编号为 ${id} 的后台命令`, true);
        return text(`${describeJob(r.job)}\n${r.text ? tail(r.text) : '（没有新的输出）'}`);
      },
    });
    pi.registerTool({
      name: 'bash_kill',
      label: 'bash_kill',
      description: '结束一个后台命令（连同它启动的子进程）。',
      parameters: Type.Object({ id: Type.Number() }),
      async execute(_id, { id }) {
        return jobs!.kill(id) ? text(`已结束 #${id}`) : text(`#${id} 不存在或已经退出`, true);
      },
    });
  };
}

export default createBackgroundExtension();
