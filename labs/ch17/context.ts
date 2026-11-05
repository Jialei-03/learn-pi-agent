// 第 17 章实验：子 Agent 省的是什么、花的是什么。
//   node labs/ch17/context.ts
// 同一个问题“Pi 压缩上下文时从哪里切开对话？”：主 Agent 自己读三个源文件，或者交给 task 子 Agent。
// 跑的是真正的 mox 命令行（mox -p），模型是一个照剧本说话的假服务器；读的文件是 node_modules 里 Pi 的真实源码。
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMox, type CliScript } from '../shared/mox-cli.ts';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const dir = 'node_modules/@earendil-works/pi-coding-agent/dist/core/compaction';
const files = ['compaction.js', 'branch-summarization.js', 'utils.js'].map(f => `${dir}/${f}`);
const question = 'Pi 压缩上下文时，从哪里切开对话？只要结论和位置。';
const taskPrompt = `在 ${dir} 里找出 Pi 压缩上下文时决定从哪里切开对话的逻辑。返回：结论、函数名和文件位置，不要贴代码。`;
const answer = `切点由 compaction.js 的 findCutPoint 决定：从最新的条目往回累计估算的 token，累计到 keepRecentTokens（默认 20000）就停，取离这里最近的合法切点。切点落在一个用户回合中间时（isSplitTurn），回合的前半段另写一份摘要。`;
const reads = files.map(path => ({ name: 'read', arguments: { path } }));

const sizes = { parent: [] as number[], child: [] as number[] };
const hasResult = (messages: any[]) => messages.some(m => m.role === 'tool');
const firstUser = (messages: any[]) => messages.find(m => m.role === 'user').content as string;

/** A：主 Agent 自己读 */
const direct: CliScript = ({ messages }) => {
  sizes.parent.push(JSON.stringify(messages).length);
  return hasResult(messages) ? { text: answer } : { toolCalls: reads };
};
/** B：主 Agent 把调研交给 task；子 Agent 的请求和主 Agent 的请求都打到同一个服务器，按第一条用户消息区分 */
const delegated: CliScript = ({ messages }) => {
  if (firstUser(messages) === taskPrompt) {
    sizes.child.push(JSON.stringify(messages).length);
    return hasResult(messages) ? { text: answer } : { toolCalls: reads };
  }
  sizes.parent.push(JSON.stringify(messages).length);
  return hasResult(messages) ? { text: answer } : { toolCalls: [{ name: 'task', arguments: { prompt: taskPrompt } }] };
};

async function scenario(script: CliScript) {
  sizes.parent = []; sizes.child = [];
  const home = mkdtempSync(join(tmpdir(), 'ch17-home-'));
  const { code, output } = await runMox(['-p', question], { cwd: repo, home, script });
  assert.equal(code, 0, output);
  // 会话文件：主会话里留下了什么
  const sessions = join(home, '.mox', 'sessions');
  const file = join(sessions, readdirSync(sessions)[0]);
  const records = readFileSync(join(file, readdirSync(file)[0]), 'utf8').trim().split('\n').map(l => JSON.parse(l).message);
  return { records, parent: sizes.parent.slice(), child: sizes.child.slice(), output };
}

const a = await scenario(direct);
const b = await scenario(delegated);

const k = (n: number) => `${(n / 1000).toFixed(1)}K`;
const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
const context = (records: any[]) => JSON.stringify(records).length;
console.log('| | 主会话最后的内容 | 主 Agent 发出的输入（累计） | 子 Agent 发出的输入（累计） | 合计 |');
console.log('| --- | --- | --- | --- | --- |');
console.log(`| A 自己读三个文件 | ${k(context(a.records))} 字符 | ${k(sum(a.parent))} | — | ${k(sum(a.parent))} |`);
console.log(`| B 交给 task | ${k(context(b.records))} 字符 | ${k(sum(b.parent))} | ${k(sum(b.child))} | ${k(sum(b.parent) + sum(b.child))} |`);

const brief = (m: any) => `${m.role}${m.tool_calls ? `（调用 ${m.tool_calls.map((c: any) => c.function.name).join('、')}）` : ''}`;
console.log(`\n主会话文件里的记录，A：${a.records.map(brief).join(' → ')}`);
console.log(`主会话文件里的记录，B：${b.records.map(brief).join(' → ')}`);
const result = b.records.find(m => m.role === 'tool');
console.log(`\nB 里主 Agent 从子 Agent 那里拿到的全部内容（${result.content.length} 个字符）：\n  ${result.content}`);
console.log(`\n终端上看到的子 Agent（缩进的几行，只在屏幕上，不进主会话）：\n${b.output.split('\n').filter(l => l.startsWith('    ')).map(l => `  ${l.trim().slice(0, 80)}`).join('\n')}`);

assert.ok(context(a.records) > 30_000, 'A：主会话里装着三个文件的全部内容');
assert.ok(context(b.records) < 1_500, 'B：主会话里只有任务说明和结论');
assert.ok(sum(b.parent) + sum(b.child) > sum(a.parent), '子 Agent 用更多的 token 换来了干净的主会话');
assert.equal(b.records.filter(m => m.role === 'tool').length, 1, '主会话里只有 task 这一个工具结果');
