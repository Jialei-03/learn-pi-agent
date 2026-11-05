// 第 4 章实验：一个跑得慢的命令，界面能看到什么？
//   node labs/ch04/progress.ts
// 命令每 0.3 秒打印一行，共 4 行。记录每个事件发生的时间点（从命令开始算起，取 300 毫秒的整数倍）。
//   mox：Event 里只有 tool_start 和 tool_end，bash 把输出攒到命令结束才一次性交出来
//   Pi ：execute 收到 onUpdate 回调，输出一到就推一次部分结果
import assert from 'node:assert/strict';
import { createBashTool as piBash } from '@earendil-works/pi-coding-agent';
import { runLoop } from '../../mox/src/loop.ts';
import { codingTools } from '../../mox/src/tools.ts';
import { scripted } from '../shared/scripted.ts';

const command = 'for i in 1 2 3 4; do echo line-$i; sleep 0.3; done';
const dir = process.cwd();
const rows: string[][] = [];
const stamp = (t0: number) => `${Math.round((performance.now() - t0) / 300) * 300} ms`;

// mox：用真实的 bash 工具跑一遍 runLoop，把每个事件的时间点记下来
{
  const t0 = performance.now();
  const model = scripted([{ toolCalls: [{ name: 'bash', arguments: { command } }] }, { text: '好了。' }]);
  await runLoop([{ role: 'user', content: '跑一下' }], {
    model, system: '', tools: codingTools(dir),
    onEvent: e => { if (e.type === 'tool_start' || e.type === 'tool_end') rows.push(['mox', stamp(t0), e.type, e.type === 'tool_end' ? e.result.replace(/\n+/g, ' ') : '']); },
  });
}

// Pi：直接调用它的 bash 工具，观察 onUpdate
{
  const t0 = performance.now();
  rows.push(['Pi', stamp(t0), 'tool_start', '']);
  let last = '';
  const result = await piBash(dir).execute('1', { command } as any, undefined, (partial: any) => {
    last = partial.content?.map((b: any) => b.text).join('') ?? '';
    if (last.trim()) rows.push(['Pi', stamp(t0), 'onUpdate', last.replace(/\n+/g, ' ').trim()]);
  });
  rows.push(['Pi', stamp(t0), 'tool_end', result.content.map((b: any) => b.text).join('').replace(/\n+/g, ' ').trim()]);
}

console.log('| 实现 | 时间点 | 事件 | 此刻界面能看到的输出 |');
console.log('| --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);

assert.equal(rows.filter(r => r[0] === 'mox').length, 2);                       // mox：开始、结束，中间什么都没有
assert.ok(rows.filter(r => r[0] === 'Pi' && r[2] === 'onUpdate').length >= 3);   // Pi：输出一到就推一次
