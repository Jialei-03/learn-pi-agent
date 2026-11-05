// 第 3 章实验：取消一个正在运行的 bash 命令，它启动的子进程会不会跟着退出？
//   node labs/ch03/abort-bash.ts
// 命令是 `sleep N; echo done`：bash 自己是父进程，sleep 是它的子进程。100ms 时取消。
// 取消 300ms 后检查系统里还有没有这个 sleep。实验结束前会把残留的进程清掉。
// 三个实现：朴素写法（只用 spawn 的 signal 选项）、mox 的 bash 工具、Pi 的 bash 工具。
import { execFileSync, spawn } from 'node:child_process';
import { createBashTool } from '@earendil-works/pi-coding-agent';
import { codingTools } from '../../mox/src/tools.ts';

const alive = (marker: string) => execFileSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8' }).split('\n').filter(l => new RegExp(`^\\s*\\d+ ${marker}$`).test(l));
const killLeftovers = (marker: string) => alive(marker).forEach(l => process.kill(Number(l.trim().split(/\s+/)[0])));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function trial(label: string, marker: string, run: (command: string, signal: AbortSignal) => Promise<string>) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const result = await run(`${marker}; echo done`, controller.signal);
  await sleep(300);
  const left = alive(marker).length;
  killLeftovers(marker);
  console.log(`| ${label} | ${JSON.stringify(result.replace(/\s+/g, ' ').trim().slice(0, 30))} | ${left ? `**还在运行**（${left} 个 ${marker}）` : '已经退出'} |`);
}

console.log('| 实现 | 取消后工具返回 | 取消 300ms 后，子进程 sleep |\n| --- | --- | --- |');

// 朴素写法：让 spawn 自己处理 signal。Node 只给直接启动的那个 bash 发 SIGTERM，它的子进程不在其中
await trial('朴素写法：spawn 加 signal', 'sleep 40', (command, signal) => new Promise(done => {
  const child = spawn('bash', ['-c', command], { signal });
  child.on('error', e => done(`[${e.name === 'AbortError' ? '已取消' : e.message}]`));
}));

// mox：bash 单独成一个进程组（detached: true），取消时向整个进程组发 SIGKILL（tools.ts 的 bash 工具）
const moxBash = codingTools(process.cwd()).find(t => t.name === 'bash')!;
await trial('mox 的 bash', 'sleep 41', (command, signal) => Promise.resolve(moxBash.run({ command }, signal)).catch(e => (e as Error).message));

// Pi：取消时杀掉整个进程树
const piBash = createBashTool(process.cwd());
await trial('Pi 的 bash', 'sleep 42', async (command, signal) => {
  const r: any = await piBash.execute('t1', { command }, signal).catch(e => ({ content: [{ text: (e as Error).message }] }));
  return r.content?.[0]?.text ?? '';
});
