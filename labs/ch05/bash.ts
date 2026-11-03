// 第 5 章实验：命令超时之后，它启动的子进程还活着吗？
//   node labs/ch05/bash.ts
// 命令在后台再启动一个 sleep（模拟 npm test 拉起的测试进程），自己也 sleep。超时 1 秒。
// 如果只杀掉 bash 本身，后台的 sleep 会变成孤儿进程继续运行。
import { execSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createBashTool as piBash } from '@earendil-works/pi-coding-agent';
import { createBashTool as moxBash } from '../../mox/src/coding/index.ts';

const survivors = (tag: string) => {
  try { return execSync(`pgrep -f "sleep ${tag}"`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length; } catch { return 0; }
};
const firstLine = (e: unknown) => (e as Error).message.trim().split('\n').at(-1);

/** 朴素实现：超时后只杀 bash 这一个进程。 */
function naiveBash(command: string, timeout?: number) {
  return new Promise<any>((resolve, reject) => {
    const child = spawn('bash', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    const timer = timeout ? setTimeout(() => { child.kill('SIGKILL'); reject(new Error('命令超时')); }, timeout * 1000) : undefined;
    child.on('close', code => { clearTimeout(timer); resolve({ content: out, isError: code !== 0 }); });
  });
}

const cases = [
  { label: '朴素实现', run: (cmd: string, timeout?: number) => naiveBash(cmd, timeout) },
  { label: 'mox', run: (cmd: string, timeout?: number) => moxBash(tmpdir()).execute({ command: cmd, timeout }, { toolCallId: '1' }) },
  { label: 'Pi', run: (cmd: string, timeout?: number) => piBash(tmpdir()).execute('1', { command: cmd, timeout } as any) },
];

console.log('| 实现 | 超时后的报错 | 1 秒后仍存活的子进程 | `exit 3` 的结果 |');
console.log('| --- | --- | --- | --- |');
for (const [i, c] of cases.entries()) {
  const tag = `${70 + i}.${Date.now() % 1000}`;          // 每个实现用不同的 sleep 时长，方便分别统计
  let timeoutMessage = '';
  try { await c.run(`sleep ${tag} & sleep ${tag}; wait`, 1); } catch (e) { timeoutMessage = firstLine(e)!; }
  await new Promise(r => setTimeout(r, 1000));
  const alive = survivors(tag);
  const exit: any = await c.run('echo 失败了 >&2; exit 3').catch(e => ({ thrown: (e as Error).message }));
  const exitText = exit.thrown ? `抛出异常` : `isError=${exit.isError === true}，${(typeof exit.content === 'string' ? exit.content : exit.content[0].text).replace(/\n+/g, ' / ')}`;
  console.log(`| ${c.label} | ${timeoutMessage} | ${alive} | ${exitText} |`);
}

// 清理：朴素实现留下的孤儿进程
try { execSync('pkill -f "sleep 70\\."'); } catch {}
