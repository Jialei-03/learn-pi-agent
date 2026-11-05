// 第 17 章实战检验：你给 mox 写的 task 工具（cli.ts 里的七行）有没有这四个性质——顺序执行、不能嵌套、权限继承、只交回结论。
//   node labs/ch17/practice.ts                      检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch17/practice.ts     检验你自己的 mox
// 跑的是真正的 mox 命令行（MOX_DIR 指向谁，跑的就是谁的 cli.ts）；模型是一个照剧本说话的假服务器，剧本按“这次请求属于谁”来回复。
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { whose } from '../shared/mox-dir.ts';
import { runMox, type CliScript } from '../shared/mox-cli.ts';

console.log(`${whose()}\n`);

const temp = (name: string) => mkdtempSync(join(tmpdir(), `ch17-${name}-`));
const firstUser = (messages: any[]) => messages.find(m => m.role === 'user').content as string;
const toolResults = (messages: any[]) => messages.filter(m => m.role === 'tool').map(m => m.content as string);
const names = (request: { tools?: { function: { name: string } }[] }) => (request.tools ?? []).map(t => t.function.name);

// ── ① 两个 task 调用写在同一条回复里：子 Agent 是一个接一个跑的 ──
let t0 = 0;                                   // 以第一次请求为 0 秒：不把进程启动的时间算进去
const timeline: string[] = [];
const at = () => ((Date.now() - t0) / 1000).toFixed(1);
const sequential: CliScript = (request) => {
  t0 ||= Date.now();
  const who = firstUser(request.messages);
  if (!who.startsWith('子任务')) {
    return toolResults(request.messages).length ? { text: '两个子任务都完成了。' } : { toolCalls: [{ name: 'task', arguments: { prompt: '子任务 #1' } }, { name: 'task', arguments: { prompt: '子任务 #2' } }] };
  }
  const id = who.slice(-2);
  const finished = toolResults(request.messages).length > 0;
  timeline.push(`${id} ${finished ? '完成' : '开始'}`.padEnd(8) + `约 ${(Math.floor(Number(at()) / 0.4) * 0.4).toFixed(1)}s`);
  return finished ? { text: `${id} 的结论` } : { toolCalls: [{ name: 'bash', arguments: { command: 'sleep 0.4' } }] };
};
const first = await runMox(['-p', '做两件独立的事', '--yolo'], { cwd: temp('seq'), home: temp('home'), script: sequential });

// ── ② 子 Agent 拿不到 task：想嵌套，只会得到“没有这个工具” ──
const nest: CliScript = (request) => {
  const who = firstUser(request.messages);
  const results = toolResults(request.messages);
  if (who === '子任务') return results.length ? { text: `我想再派一个子 Agent，结果是：${results[0]}` } : { toolCalls: [{ name: 'task', arguments: { prompt: '孙任务' } }] };
  return results.length ? { text: '完成' } : { toolCalls: [{ name: 'task', arguments: { prompt: '子任务' } }] };
};
const second = await runMox(['-p', '派一个子 Agent', '--yolo'], { cwd: temp('nest'), home: temp('home'), script: nest });
const [parentRequest] = second.requests.filter(r => firstUser(r.messages) === '派一个子 Agent');
const [childRequest] = second.requests.filter(r => firstUser(r.messages) === '子任务');

// ── ③ 子 Agent 的每个工具调用，和主 Agent 一样先过 beforeTool ──
const work = temp('perm');
writeFileSync(join(work, 'guard.ts'), "export default mox => mox.on('tool_call', (name, args) => name === 'bash' && /\\brm\\b/.test(args.command) ? '不允许删除文件' : undefined);\n");
const perm: CliScript = (request) => {
  const who = firstUser(request.messages);
  const results = toolResults(request.messages);
  if (who === '清理并汇报') return results.length ? { text: '完成' } : { toolCalls: [{ name: 'task', arguments: { prompt: '子任务：删掉 build，再 echo ok' } }] };
  if (results.length === 0) return { toolCalls: [{ name: 'bash', arguments: { command: 'rm -rf build' } }] };
  if (results.length === 1) return { toolCalls: [{ name: 'bash', arguments: { command: 'echo ok' } }] };
  return { text: `rm 的结果：${results[0]}；echo 的结果：${results[1]}` };
};
const withYolo = await runMox(['-p', '清理并汇报', '--yolo', '-e', join(work, 'guard.ts')], { cwd: work, home: temp('home'), script: perm });
const noYolo = await runMox(['-p', '清理并汇报', '-e', join(work, 'guard.ts')], { cwd: work, home: temp('home'), script: perm });
const reportOf = (run: typeof withYolo) => run.requests.at(-2)!.messages.filter((m: any) => m.role === 'tool').map((m: any) => m.content.split('\n')[0]);

console.log('① 一条回复里有两个 task 调用，子 Agent 的先后（每个子 Agent 里有一条 0.4 秒的命令）：');
console.log(timeline.map(l => `   ${l}`).join('\n'));
console.log('\n| 性质 | 观察到的 |\n| --- | --- |');
console.log(`| ② 嵌套 | 主 Agent 的工具：${names(parentRequest).join('、')}；子 Agent 的工具：${names(childRequest).join('、')} |`);
console.log(`| ② 嵌套 | 子 Agent 硬要调用 task，得到：${toolResults(second.requests.find(r => firstUser(r.messages) === '子任务' && toolResults(r.messages).length)!.messages)[0]} |`);
console.log(`| ③ 权限（--yolo，扩展拦 rm） | 子 Agent 的 rm 得到：${reportOf(withYolo)[0]}；echo 得到：${reportOf(withYolo)[1]} |`);
console.log(`| ③ 权限（没有 --yolo、没有终端） | 子 Agent 的 rm 得到：${reportOf(noYolo)[0]}；echo 得到：${reportOf(noYolo)[1]} |`);
const parentRequests = second.requests.filter(r => firstUser(r.messages) === '派一个子 Agent');
const lastParent = parentRequests.at(-1)!.messages.slice(1);
console.log(`| ④ 只交回结论 | 主 Agent 第二次请求的消息：${lastParent.map((m: any) => m.role).join(' → ')}；其中 tool 消息就是子 Agent 的最后一句：“${lastParent.at(-1).content}” |`);

// 顺序：第二个子 Agent 在第一个完成之后才开始
const order = timeline.map(l => l.split(' ').slice(0, 2).join(' '));
assert.deepEqual(order, ['#1 开始', '#1 完成', '#2 开始', '#2 完成']);
assert.deepEqual(lastParent.map((m: any) => m.role), ['user', 'assistant', 'tool'], '子 Agent 的过程不进主 Agent 的上下文');
assert.match(lastParent.at(-1).content, /我想再派一个子 Agent/);
assert.ok(names(parentRequest).includes('task') && !names(childRequest).includes('task'));
assert.match(toolResults(second.requests.find(r => firstUser(r.messages) === '子任务' && toolResults(r.messages).length)!.messages)[0], /没有名为 task 的工具/);
assert.match(reportOf(withYolo)[0], /不允许删除文件/);
assert.ok(!/错误/.test(reportOf(withYolo)[1]), 'echo 没有被拦');
assert.match(reportOf(noYolo)[1], /没有终端可以确认/);
assert.equal(first.code, 0);
