// 第 3 章实战的检验：mox 的 runLoop 的保护 —— 每个调用都有结果、截断不执行、插话、取消。
//   node labs/ch03/practice.ts                      检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch03/practice.ts     检验你自己写的
// 需要 src/loop.ts 导出 runLoop(messages, { model, system, tools, signal?, steer?, onEvent? })。
// 五个情形和 compare.ts 是同一份脚本，这次交给你的 runLoop，旁边列出 Pi 的结果对照。
import assert from 'node:assert/strict';
import { loadMox, whose } from '../shared/mox-dir.ts';
import { scripted } from '../shared/scripted.ts';
import { compact, mox, pi } from './runners.ts';
import { createWorld, scenarios } from './scenarios.ts';

console.log(`${whose()}\n`);
const { runLoop } = await loadMox('loop.ts');

// ① 五个情形：mox 和 Pi 并排
const rows: string[] = [];
const run = async (name: string, hostStop = false) => ({ m: await mox(runLoop, scenarios[name], hostStop), p: await pi(scenarios[name], hostStop) });
const line = (label: string, m: any, p: any) =>
  rows.push(`| ${label} | ${m.requests} / ${p.requests} | ${compact(m.toolRuns)} / ${compact(p.toolRuns)} | ${m.outcome} | ${p.outcome} |`);

let { m, p } = await run('success');
assert.equal(m.requests, 2); assert.match(m.outcome, /命令行笔记工具/);
line('成功路径', m, p);

({ m, p } = await run('truncated'));
assert.equal(m.requests, 3, '截断后要再请求一次，让模型重新发起');
assert.deepEqual(m.toolRuns, ['write INSTALL.md'], 'length 的那条回复里的调用一个都不能执行，只有重新发起的那次写了文件');
assert.equal(m.install, '## 安装\n1. 克隆仓库\n2. 运行 npm install\n', '磁盘上必须是完整的内容，不能是半截');
line('输出截断', m, p);

({ m, p } = await run('missing'));
assert.equal(m.requests, 2, '工具抛异常要变成一条结果交给模型，不能崩');
assert.match(m.outcome, /absent\.md/);
line('工具失败', m, p);

({ m, p } = await run('steer'));
assert.equal(m.requests, 2);
assert.equal(m.outcome, 'Mox Notes 是一个命令行笔记工具。', '插话要在下一次请求前进入历史');
assert.deepEqual(m.unread, []);
line('中途插话', m, p);

({ m, p } = await run('runaway'));
assert.equal(m.requests, 8, '没有宿主策略时，循环自己不会停（和 Pi 一样）');
line('停不下来（不设限）', m, p);
({ m, p } = await run('runaway', true));
assert.equal(m.requests, 3, '宿主在 onEvent 里数工具执行次数，够了就 abort()');
assert.match(m.outcome, /AbortError/);
line('停不下来（宿主叫停：mox 取消 / Pi finishTurn）', m, p);

console.log('| 情形 | 请求次数 mox / Pi | 工具实际执行 mox / Pi | mox 的结局 | Pi 的结局 |\n| --- | --- | --- | --- | --- |');
console.log(rows.join('\n'));

// ② 每个调用都有结果：同一条回复里两个调用，取消发生在第一个运行期间
{
  const controller = new AbortController();
  const started: string[] = [];
  const tool = {
    name: 'long_task', description: '耗时任务', parameters: { type: 'object', properties: {} },
    run: (_args: unknown, signal?: AbortSignal) => new Promise<string>((resolve, reject) => {
      started.push('开始');
      const timer = setTimeout(() => resolve('完成'), 2000);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('已取消')); }, { once: true });
    }),
  };
  const model = scripted((_m, n) => (n === 1 ? { toolCalls: [{ id: 'a', name: 'long_task', arguments: {} }, { id: 'b', name: 'long_task', arguments: {} }] } : { text: '完成了。' }));
  const messages: any[] = [{ role: 'user', content: '跑两次' }];
  setTimeout(() => controller.abort(), 100);
  const outcome = await runLoop(messages, { model, system: '', tools: [tool], signal: controller.signal }).then(() => '正常返回', (e: Error) => e.name);
  const results = messages.filter(x => x.role === 'tool');
  assert.equal(outcome, 'AbortError', '取消后下一次请求会抛 AbortError，不能再正常返回');
  assert.deepEqual(results.map(x => x.tool_call_id), ['a', 'b'], '两个调用都要有一条结果，哪怕第二个根本没开始');
  assert.equal(started.length, 1, '第二个调用不能开始运行');
  assert.ok(results.every(x => x.content.startsWith('错误：')));
  console.log(`\n取消：runLoop ${outcome}；历史里的两条工具结果：${results.map(x => JSON.stringify(x.content)).join('、')}；真正开始运行的调用 ${started.length} 个`);
}

// ③ 模型调用不存在的工具、参数不是合法 JSON：都变成错误结果
{
  const model = scripted((_m, n) => n === 1
    ? { toolCalls: [{ id: 'x', name: 'nope', arguments: {} }] }
    : n === 2 ? { toolCalls: [{ id: 'y', name: 'read', arguments: { path: 'README.md' } }] } : { text: '好' });
  const world = createWorld(scenarios.success);
  const messages: any[] = [{ role: 'user', content: '随便' }];
  await runLoop(messages, { model, system: '', tools: world.tools });
  const results = messages.filter(x => x.role === 'tool').map(x => x.content as string);
  assert.match(results[0], /^错误：.*nope/);
  assert.match(results[1], /Mox Notes/);
  console.log(`幻觉出来的工具名：${JSON.stringify(results[0])}；随后的正常调用照常执行`);
}

// ④ 追加任务在循环外面：宿主在 runLoop 返回后给出下一句话
{
  const U = '读取 README.md，介绍这个项目', S = '只用一句话回答', F = '再列出 src 目录';
  const steering: string[] = [], followUps: string[] = [];
  const seen: string[] = [];
  const short = (t: string) => (t === U ? 'U' : t === S ? 'S' : t === F ? 'F' : '?');
  const model = scripted((messages, n) => {
    seen.push(messages.filter(x => x.role === 'user').map(x => short(x.content)).join(''));
    return n === 1 ? { toolCalls: [{ name: 'read', arguments: { path: 'README.md' } }] } : { text: `第 ${n} 次` };
  });
  const tools = [{ name: 'read', description: '读', parameters: { type: 'object', properties: {} }, run: () => { steering.push(S); followUps.push(F); return '# Mox Notes'; } }];
  const messages: any[] = [];
  let text: string | undefined = U;
  while (text) {                                   // 这几行就是命令行的 run()：runLoop 返回后问“还有下一句吗”
    messages.push({ role: 'user', content: text });
    await runLoop(messages, { model, system: '', tools, steer: () => steering.splice(0) });
    text = followUps.shift();
  }
  assert.deepEqual(seen, ['U', 'US', 'USF'], '插话 S 在第 2 次请求出现，追加任务 F 在第 3 次');
  console.log(`\n每次请求时模型看到的用户消息：${seen.map((s, i) => `第 ${i + 1} 次 ${s.split('').join('、')}`).join('；')}`);
}

console.log('\n全部通过');
