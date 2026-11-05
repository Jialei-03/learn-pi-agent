// 第 5 章实验：mox 第一次改代码（离线版）。
//   node labs/ch05/fix-bug.ts
// 用脚本模型代替真实模型，其余都是真的：mox 的 runLoop、四个编程工具、临时目录里一个有 bug 的小项目。
// 脚本里的模型先跑测试，再读文件，第一次 edit 故意写得不够唯一（add 和 sub 的函数体长得一样），
// 看工具怎样用一句错误提示把它拉回来。测试失败（退出码非 0）同样是一条错误结果。
import assert from 'node:assert/strict';
import { scripted } from '../shared/scripted.ts';
import { file, freshProject, runTask } from './shared.ts';

const dir = freshProject();
const model = scripted([
  { text: '先运行测试看看哪里失败。', toolCalls: [{ name: 'bash', arguments: { command: 'node test.js' } }] },
  { toolCalls: [{ name: 'read', arguments: { path: 'calc.js' } }] },
  { text: 'add 写成了减法。', toolCalls: [{ name: 'edit', arguments: { path: 'calc.js', edits: [{ oldText: 'return a - b;', newText: 'return a + b;' }] } }] },
  { text: '这段文字出现了两次，带上函数名让它唯一。', toolCalls: [{ name: 'edit', arguments: { path: 'calc.js', edits: [{ oldText: 'function add(a, b) {\n  return a - b;', newText: 'function add(a, b) {\n  return a + b;' }] } }] },
  { toolCalls: [{ name: 'bash', arguments: { command: 'node test.js' } }] },
  { text: '修好了：add 原来写成了减法，改成 a + b 后测试通过。' },
]);

const { lines, answer } = await runTask(model, dir, '运行 node test.js，修好失败的测试');
console.log(lines.join('\n'));
console.log(`\n${answer}\n`);
console.log(`模型被请求了 ${model.requests.length} 次；calc.js 里的 add：`);
console.log(file(dir, 'calc.js').split('\n').slice(1, 4).join('\n'));

assert.match(lines.join('\n'), /✗ 错误：oldText 出现了 2 次/);        // 第一次 edit 因为不唯一被拒绝
assert.match(file(dir, 'calc.js'), /function add\(a, b\) \{\n  return a \+ b;/);
assert.match(file(dir, 'calc.js'), /function sub\(a, b\) \{\n  return a - b;/);   // sub 没有被误改
assert.equal(lines.at(-1), '  ✓ ok [退出码 0]');
