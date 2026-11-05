// 第 4 章实验：一个跑得慢的命令，Pi 的界面能看到什么？
//   node labs/ch04/pi-progress.ts
// 命令每 0.3 秒打印一行，共 4 行。Pi 的 execute 收到 onUpdate 回调，输出一到就推一次部分结果。
// 时间点从命令开始算起，取 300 毫秒的整数倍。
import assert from 'node:assert/strict';
import { createBashTool as piBash } from '@earendil-works/pi-coding-agent';

const command = 'for i in 1 2 3 4; do echo line-$i; sleep 0.3; done';
const rows: string[][] = [];
const t0 = performance.now();
const stamp = () => `${Math.round((performance.now() - t0) / 300) * 300} ms`;
rows.push([stamp(), 'tool_start', '']);
const result = await piBash(process.cwd()).execute('1', { command } as any, undefined, (partial: any) => {
  const text = partial.content?.map((b: any) => b.text).join('') ?? '';
  if (text.trim()) rows.push([stamp(), 'onUpdate', text.replace(/\n+/g, ' ').trim()]);
});
rows.push([stamp(), 'tool_end', result.content.map((b: any) => b.text).join('').replace(/\n+/g, ' ').trim()]);

console.log('| 时间点 | 事件 | 此刻界面能看到的输出 |');
console.log('| --- | --- | --- |');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
assert.ok(rows.filter(r => r[1] === 'onUpdate').length >= 3);
