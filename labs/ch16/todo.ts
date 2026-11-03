// 第 16 章实验：任务清单。状态存在工具结果里，回到会话树的某个节点时，清单也回到那时的样子。
//   node labs/ch16/todo.ts
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createTodoExtension, renderTodos, type Todo } from '../../extensions/todo/index.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';

const steps = ['读懂现有的命令解析', '实现 list 命令', '补测试'];
const list = (...status: Todo['status'][]) => ({ todos: steps.map((content, i) => ({ content, status: status[i] })) });
const write = (args: object, id: string) => fauxAssistantMessage(fauxToolCall('todo_write', args, { id }), { stopReason: 'toolUse' });
let widget: string[] | undefined;
let reminder = '';
const { session } = await createPiSession({
  ui: { setWidget: (_k: string, lines?: string[]) => { widget = lines; } },
  extensions: [createTodoExtension()],
  responses: [
    write(list('pending', 'pending', 'pending'), 't1'),
    write(list('in_progress', 'pending', 'pending'), 't2'),
    write(list('completed', 'in_progress', 'in_progress'), 't3'),        // 两个 in_progress：会被拒绝
    write(list('completed', 'in_progress', 'pending'), 't4'),
    fauxAssistantMessage('先做到这里。'),
    (context: any) => { reminder = context.messages.filter((m: any) => m.role === 'user' || m.role === 'custom').map(textOf).find((t: string) => t.includes('<todos>')) ?? ''; return fauxAssistantMessage('继续。'); },
  ],
});
await session.prompt('给 mox 加 list 命令，记得补测试');
console.log('━━ 模型每次调用 todo_write 的结果 ━━');
for (const m of session.messages as any[]) if (m.role === 'toolResult') console.log(`${m.isError ? '✗' : '✓'} ${textOf(m).split('\n').join(' | ')}`);
console.log(`\n界面上的清单：\n  ${widget?.join('\n  ')}`);

await session.prompt('继续');
console.log(`\n下一次提问时，附在提示后面的隐藏消息：\n  ${reminder.split('\n').join('\n  ')}`);

// 回到第一次 todo_write 之后的那个节点：清单应该回到“三项都没开始”
const firstResult = (session.sessionManager.getBranch() as any[]).find(e => e.type === 'message' && e.message.role === 'toolResult');
await session.navigateTree(firstResult.id);
console.log(`\n回到会话树上第一次 todo_write 之后的节点，界面上的清单：\n  ${widget?.join('\n  ')}`);
session.dispose();
void renderTodos;
