// 第 9 章实验：一次 `mox -p` 运行里，扩展的各个入口按什么顺序被调用？
//   node labs/ch09/order.ts
// 这里启动的是真正的 mox 命令行（mox/src/cli.ts），模型换成本地的假服务（labs/shared/mox-cli.ts 的 runMox）。
// 一个扩展把自己被调用的每个入口都追加写进同一个日志文件；假服务收到请求时也写一行。
// 两边都是同步追加，日志里的先后顺序就是真实发生的顺序。
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMox } from '../shared/mox-cli.ts';

const root = mkdtempSync(join(tmpdir(), 'ch09-order-'));
const cwd = join(root, 'project');
const home = join(root, 'home');
mkdirSync(cwd); mkdirSync(home);
writeFileSync(join(cwd, 'README.md'), '# demo\n安装：npm install\n');
const log = join(root, 'trace.log');
const note = (line: string) => appendFileSync(log, line + '\n');

// 追踪扩展：每个入口都留一行记录，从不返回理由，所以不会改变运行本身；只有 agent_end 第一次返回一句话，让 Agent 接着干
const extension = join(root, 'trace.ts');
writeFileSync(extension, `
import { appendFileSync } from 'node:fs';
const note = line => appendFileSync(${JSON.stringify(log)}, line + '\\n');
export default mox => {
  note('扩展函数被调用（加载阶段）');
  mox.registerTool({ name: 'now', description: '当前时间', parameters: { type: 'object', properties: {} }, run: () => { note('    工具 now 执行'); return '12:00'; } });
  let calls = 0;
  mox.addSystemPrompt(() => { note('addSystemPrompt 取值，返回「片段 v' + ++calls + '」'); return '片段 v' + calls; });
  mox.on('tool_call', (name) => { note('  tool_call ' + name); });
  mox.on('tool_result', (name, args, result) => { note('  tool_result ' + name + ' → ' + result.replace(/\\s+/g, " ").slice(0, 24)); });
  let continued = false;
  mox.on('agent_end', answer => {
    note('agent_end 收到最终回答「' + answer + '」' + (continued ? '，返回空，运行结束' : '，返回一句话，让 Agent 接着干'));
    if (!continued) { continued = true; return '再确认一下 README 里有没有安装说明'; }
  });
  mox.on('shutdown', () => { note('shutdown'); });
};
`);

// runMox 起一个只会照剧本说话的假模型，再运行真正的 `mox -p`；剧本收到请求时顺手写一行日志
const { code, output } = await runMox(['-p', '看看 README', '--yolo', '-e', extension], {
  cwd, home,
  script: (request, n) => {
    note(`→ 第 ${n} 次请求发往模型，系统提示里带的是「${String(request.messages[0].content).match(/片段 v\d+/)?.[0]}」`);
    if (n === 1) return { text: '先看一眼 README 和时间。', toolCalls: [{ name: 'read', arguments: { path: 'README.md' } }, { name: 'now', arguments: {} }] };
    if (n === 2) return { text: 'README 里有安装步骤。' };
    return { text: '有，运行 npm install。' };
  },
});
assert.equal(code, 0, output);

const lines = readFileSync(log, 'utf8').trim().split('\n');
console.log(lines.map((line, i) => `${String(i + 1).padStart(2)}. ${line}`).join('\n'));

const at = (prefix: string, from = 0) => lines.findIndex((l, i) => i >= from && l.trim().startsWith(prefix));
// 顺序：加载 → 取系统提示 → 请求 → 每个工具依次 tool_call、执行、tool_result → 请求 → agent_end → 再来一轮（重新取系统提示）→ agent_end → shutdown
assert.ok(at('扩展函数被调用') < at('addSystemPrompt') && at('addSystemPrompt') < at('→ 第 1 次'));
assert.ok(at('tool_call read') < at('tool_result read') && at('tool_result read') < at('tool_call now'), '工具依次执行，一个做完才轮到下一个');
assert.ok(at('→ 第 2 次') > at('tool_result now'));
assert.ok(at('agent_end') < at('addSystemPrompt', at('agent_end')), 'agent_end 续跑之后，系统提示重新取值');
// 同一次运行里的两次请求带着同一个版本；续跑的那一次运行才拿到新的
const sent = lines.filter(l => l.startsWith('→')).map(l => l.match(/片段 v(\d+)/)![1]);
assert.equal(sent[0], sent[1]);
assert.ok(Number(sent[2]) > Number(sent[1]));
assert.equal(lines.at(-1), 'shutdown');
