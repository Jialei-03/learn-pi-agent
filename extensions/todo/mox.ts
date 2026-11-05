// mox 扩展：任务清单（第 16 章）。模型用 todo_write 维护一份带状态的清单，格式与 Claude Code 的 TodoWrite 相同：
// 每次写入完整的清单，状态是 pending / in_progress / completed，同一时间只能有一个 in_progress。
// 状态放在扩展的内存里；清单通过 addSystemPrompt 在每次运行前重新放进系统提示，所以压缩上下文之后模型也不会忘。
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import type { Todo } from './index.ts';

const STATUS = ['pending', 'in_progress', 'completed'] as const;
const MARK = { pending: '☐', in_progress: '◐', completed: '☑' } as const;
const render = (todos: Todo[]) => todos.map(t => `${MARK[t.status]} ${t.content}`).join('\n');

export function createTodoMoxExtension() {
  return (mox: ExtensionApi) => {
    let todos: Todo[] = [];
    const open = () => todos.filter(t => t.status !== 'completed').length;

    mox.registerTool({
      name: 'todo_write',
      description: [
        '创建和更新任务清单。每次传入完整的清单。',
        '用于需要三步以上的任务：开始时列出步骤；开始做某一步时把它标成 in_progress（同一时间只能有一个）；做完立即标成 completed，不要攒着一起标。',
        '简单的一两步任务不需要清单。',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: { content: { type: 'string', description: '这一步要做什么' }, status: { type: 'string', enum: [...STATUS] } },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
      run: ({ todos: next }: { todos: Todo[] }) => {
        // mox 不校验参数，形状对不对要自己检查。抛出的错误会作为工具结果交给模型，状态保持不变：
        // 清单是模型的工作记忆，不能被一次错误的调用弄乱
        if (!Array.isArray(next) || next.some(t => typeof t?.content !== 'string' || !STATUS.includes(t.status))) {
          throw new Error('todos 必须是 [{ content, status }] 的数组，status 只能是 pending、in_progress、completed');
        }
        if (next.filter(t => t.status === 'in_progress').length > 1) throw new Error('同一时间只能有一个 in_progress 的任务。请先完成或暂停当前的任务。');
        todos = next;
        return `${render(todos)}\n\n${open() ? `还有 ${open()} 项未完成。` : '全部完成。'}`;
      },
    });

    // 清单要在模型的视线里：还有未完成的项，就把当前清单放进系统提示。系统提示不会被压缩掉
    mox.addSystemPrompt(() => (open() ? `<todos>\n当前的任务清单：\n${render(todos)}\n</todos>` : ''));

    mox.registerCommand('todos', () => process.stdout.write(todos.length ? `${render(todos)}\n` : '还没有任务清单\n'));
  };
}

export default createTodoMoxExtension();
