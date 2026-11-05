// 第 16 章实验：任务清单装进 mox。todo_write 是一个普通工具，状态在扩展的内存里，清单靠系统提示留在模型的视线里。
//   node labs/ch16/mox-todo.ts
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodoMoxExtension } from '../../extensions/todo/mox.ts';
import type { Todo } from '../../extensions/todo/index.ts';
import { scripted } from '../shared/scripted.ts';
import { assemble } from '../ch14/host.ts';

const steps = ['读懂现有的命令解析', '实现 list 命令', '补测试'];
const list = (...status: Todo['status'][]) => ({ todos: steps.map((content, i) => ({ content, status: status[i] })) });
const writes = [
  list('pending', 'pending', 'pending'),
  list('in_progress', 'pending', 'pending'),
  list('completed', 'in_progress', 'in_progress'),      // 两个 in_progress：会被拒绝
  { todos: [{ content: '补测试', status: 'doing' }] },    // 状态写错了：mox 不校验参数，工具自己检查
  list('completed', 'in_progress', 'pending'),
];
const model = () => scripted((_m, n) => (n <= writes.length ? { toolCalls: [{ name: 'todo_write', arguments: writes[n - 1] }] } : { text: '先做到这里。' }));
const cwd = mkdtempSync(join(tmpdir(), 'ch16-todo-'));

const host = await assemble({ cwd, model: model(), sources: [createTodoMoxExtension()], yolo: true });
await host.run('给 mox 加 list 命令，记得补测试');
console.log('━━ 模型每次调用 todo_write 的结果 ━━');
for (const s of host.steps) console.log(`${s.error ? '✗' : '✓'} ${s.result.split('\n').filter(Boolean).join(' | ')}`);
// 正文的结论：第三次（两个 in_progress）和第四次（status 不合法）被拒绝，而且状态保持不变
assert.deepEqual(host.steps.map(s => !s.error), [true, true, false, false, true]);

const reminder = () => host.system().split('\n\n').find(p => p.startsWith('<todos>')) ?? '（没有）';
console.log(`\n下一次运行时，系统提示末尾的清单：\n  ${reminder().split('\n').join('\n  ')}`);
assert.ok(reminder().includes('◐ 实现 list 命令') && reminder().includes('☐ 补测试'));

console.log('\n━━ 清单全部完成之后 ━━');
const done = await assemble({ cwd, model: scripted([{ toolCalls: [{ name: 'todo_write', arguments: list('completed', 'completed', 'completed') }] }, { text: '全部完成。' }]), sources: [createTodoMoxExtension()], yolo: true });
await done.run('收尾');
console.log(`系统提示里还有清单吗？${done.system().includes('<todos>') ? '有' : '没有（没有未完成的项就不再提醒）'}`);
assert.ok(!done.system().includes('<todos>'));

console.log('\n━━ 恢复会话（mox -c）：扩展是新的，内存是空的 ━━');
const resumed = await assemble({ cwd, model: model(), sources: [createTodoMoxExtension()], yolo: true });
resumed.messages.push(...host.messages);                    // 对话恢复了
console.log(`对话里有 ${resumed.messages.length} 条消息，包括之前所有的 todo_write 结果；系统提示里的清单：${resumed.system().includes('<todos>') ? '有' : '没有'}`);
assert.ok(!resumed.system().includes('<todos>'));

console.log('\n━━ 没有权限扩展时，内置确认怎么对待 todo_write ━━');
const asked = await assemble({ cwd, model: model(), sources: [createTodoMoxExtension()], answers: ['本次会话都允许'] });
await asked.run('给 mox 加 list 命令');
console.log(`五次 todo_write，内置确认只问了 ${asked.questions.length} 次（第一次）：选了“本次会话都允许”之后，同一个工具不再问。`);
assert.equal(asked.questions.length, 1);
