// mox 扩展：后台命令（第 18 章）。三个工具：bash_background 启动，bash_output 看新输出，bash_kill 结束。
// mox 的扩展没有“往会话里发一条消息把 Agent 叫醒”的接口（Pi 的 sendMessage + triggerTurn 做的就是这件事），
// 能做的是在 Agent 准备停下的那一刻（agent_end）接话：模型启动命令时可以声明 notify，
// 那么它说完话之后，扩展会一直等到命令结束，再把结局当作新的一句话交给它——等待期间不发任何模型请求。
// 用法：mox -e extensions/background/mox.ts
import type { Extension } from '../../mox/src/extensions.ts';
import { BackgroundJobs, describeJob, type Job } from './jobs.ts';

const tail = (text: string, n = 2000) => (text.length > n ? `…（前面省略 ${text.length - n} 个字符）\n${text.slice(-n)}` : text);

export function createBackgroundMoxExtension({ maxWaitMs = 10 * 60_000 } = {}): Extension {
  return mox => {
    const jobs = new BackgroundJobs(mox.cwd);
    const notify = new Set<number>();                       // 模型要求“结束时告诉我”的命令
    const told = new Set<number>();                         // 结局已经告诉过模型的命令
    const exited = new Map<number, Promise<void>>();        // 每个命令的“结束了”信号
    const resolvers = new Map<number, () => void>();
    jobs.onExit = job => resolvers.get(job.id)?.();

    const report = (job: Job) => `后台命令 ${describeJob(job)}\n最后的输出：\n${tail(jobs.read(job.id)?.text.trim() || '（没有新的输出）')}`;

    mox.on('shutdown', () => jobs.killAll());               // 退出时清理，否则 mox -p 的子进程会留在后台

    // 下一次运行前，让模型知道还有哪些命令在跑（系统提示每次运行都会重新取值）
    mox.addSystemPrompt(() => {
      const running = [...jobs.jobs.values()].filter(j => j.status === 'running');
      return running.length ? `当前的后台命令：\n${running.map(j => `- ${describeJob(j)}`).join('\n')}` : '';
    });

    // Agent 准备停下：有“结束时告诉我”的命令还没交代，就等到它结束，把结局当作下一句话
    mox.on('agent_end', async () => {
      const deadline = Date.now() + maxWaitMs;
      while (true) {
        const finished = [...notify].filter(id => jobs.jobs.get(id)?.status === 'exited' && !told.has(id));
        if (finished.length) {
          finished.forEach(id => told.add(id));
          return finished.map(id => report(jobs.jobs.get(id)!)).join('\n\n');
        }
        const running = [...notify].filter(id => jobs.jobs.get(id)?.status === 'running');
        if (!running.length || Date.now() >= deadline) return;
        // 超时的计时器不能挡住进程退出：unref；等到有命令结束就放弃它
        await Promise.race([...running.map(id => exited.get(id)!), new Promise(r => setTimeout(r, deadline - Date.now()).unref())]);
      }
    });

    mox.registerTool({
      name: 'bash_background',
      description: '在后台启动一个长时间运行的命令（开发服务器、监听模式的测试、耗时的构建），立即返回编号。用 bash_output 查看输出，用 bash_kill 结束。命令会结束、并且你需要它的结果时（构建、测试），设置 notify 为 true：你说完话之后会等它结束，再把结果告诉你，不需要反复查看。开发服务器这类不会结束的命令不要设 notify。',
      parameters: { type: 'object', properties: { command: { type: 'string', description: '要执行的命令' }, notify: { type: 'boolean', description: '结束时把结果告诉我' } }, required: ['command'] },
      run: ({ command, notify: wake }) => {
        const job = jobs.start(command);
        exited.set(job.id, new Promise(resolve => resolvers.set(job.id, resolve)));
        if (wake) notify.add(job.id);
        return `已在后台启动 #${job.id}。${wake ? '你说完话之后我会等它结束，再告诉你结果。' : ''}`;
      },
    });
    mox.registerTool({
      name: 'bash_output',
      description: '查看后台命令自上次查看以来的新输出和当前状态。',
      parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      run: ({ id }) => {
        const r = jobs.read(id);
        if (!r) throw new Error(`没有编号为 ${id} 的后台命令`);
        return `${describeJob(r.job)}\n${tail(r.text, 4000) || '（没有新的输出）'}`;
      },
    });
    mox.registerTool({
      name: 'bash_kill',
      description: '结束一个后台命令（连同它启动的子进程）。',
      parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      run: ({ id }) => {
        if (!jobs.kill(id)) throw new Error(`#${id} 不存在或已经退出`);
        return `已结束 #${id}`;
      },
    });
  };
}

export default createBackgroundMoxExtension();
