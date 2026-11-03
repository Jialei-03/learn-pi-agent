// mox 扩展：后台命令（第 18 章）。工具与 Pi 版本相同；mox 的扩展不能主动开始新的一轮，命令结束时只在终端提示。
import type { MoxExtension } from '../../mox/src/extensions.ts';
import { BackgroundJobs, describeJob } from './jobs.ts';

export function createBackgroundMoxExtension(): MoxExtension {
  return api => {
    let jobs: BackgroundJobs | undefined;
    api.on('session_start', ({ cwd }) => {
      jobs = new BackgroundJobs(cwd);
      jobs.onExit = job => process.stderr.write(`\n[后台] ${describeJob(job)}\n`);
    });
    api.on('session_shutdown', () => jobs?.killAll());
    api.registerTool({
      name: 'bash_background', description: '在后台启动一个长时间运行的命令，立即返回编号。用 bash_output 查看输出，用 bash_kill 结束。',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      execute: ({ command }) => `已在后台启动 #${jobs!.start(command).id}。`,
    });
    api.registerTool({
      name: 'bash_output', description: '查看后台命令自上次查看以来的新输出和状态。',
      parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      execute: ({ id }) => { const r = jobs!.read(id); return r ? `${describeJob(r.job)}\n${r.text || '（没有新的输出）'}` : { content: `没有编号为 ${id} 的后台命令`, isError: true }; },
    });
    api.registerTool({
      name: 'bash_kill', description: '结束一个后台命令。',
      parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      execute: ({ id }) => (jobs!.kill(id) ? `已结束 #${id}` : { content: `#${id} 不存在或已经退出`, isError: true }),
    });
  };
}

export default createBackgroundMoxExtension();
