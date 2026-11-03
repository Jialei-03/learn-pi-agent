// Pi 扩展：任务清单（第 16 章）。模型用 todo_write 维护一份带状态的清单，用户随时看得到进度。
// 格式与 Claude Code 的 TodoWrite 相同：每次写入完整的清单（不是增量修改），状态是 pending / in_progress / completed。
// 状态保存在工具结果的 details 里（Pi 官方 todo 示例的做法）：切换分支时，清单自动回到那个时间点的样子。
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

export interface Todo { content: string; status: 'pending' | 'in_progress' | 'completed' }
const MARK = { pending: '☐', in_progress: '◐', completed: '☑' } as const;
export const renderTodos = (todos: Todo[]) => todos.map(t => `${MARK[t.status]} ${t.content}`).join('\n');

/** 从当前分支的工具结果里找到最后一份清单 */
export function todosOnBranch(ctx: ExtensionContext): Todo[] {
  let todos: Todo[] = [];
  for (const entry of ctx.sessionManager.getBranch() as any[]) {
    if (entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'todo_write' && entry.message.details?.todos) todos = entry.message.details.todos;
  }
  return todos;
}

export function createTodoExtension() {
  return (pi: ExtensionAPI) => {
    let todos: Todo[] = [];
    const show = (ctx: ExtensionContext) => {
      const open = todos.filter(t => t.status !== 'completed').length;
      ctx.ui.setWidget('todos', todos.length && open ? renderTodos(todos).split('\n') : undefined);
    };

    pi.registerTool({
      name: 'todo_write',
      label: 'todo_write',
      description: [
        '创建和更新任务清单。每次传入完整的清单。',
        '用于需要三步以上的任务：开始时列出步骤；开始做某一步时把它标成 in_progress（同一时间只能有一个）；做完立即标成 completed，不要攒着一起标。',
        '简单的一两步任务不需要清单。',
      ].join('\n'),
      parameters: Type.Object({
        todos: Type.Array(Type.Object({
          content: Type.String({ description: '这一步要做什么' }),
          status: StringEnum(['pending', 'in_progress', 'completed'] as const),
        })),
      }),
      // 只改 Agent 自己的状态，不碰外部环境：权限扩展不必为它弹确认框
      annotations: { readOnlyHint: true },
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const next = params.todos as Todo[];
        // 校验失败时返回错误，并且不改变状态：清单是模型的工作记忆，不能被一次错误的调用弄乱
        if (next.filter(t => t.status === 'in_progress').length > 1) {
          return { content: [{ type: 'text', text: '同一时间只能有一个 in_progress 的任务。请先完成或暂停当前的任务。' }], details: { todos }, isError: true };
        }
        todos = next;
        show(ctx);
        const left = todos.filter(t => t.status !== 'completed').length;
        return { content: [{ type: 'text', text: `${renderTodos(todos)}\n\n${left ? `还有 ${left} 项未完成。` : '全部完成。'}` }], details: { todos } };
      },
    });

    // 清单要在模型的视线里：每次用户提问时，如果还有未完成的项，把当前清单作为隐藏消息附上。
    // 长任务中途压缩后，旧的 todo_write 结果可能已经不在上下文里了，这一步保证模型不会忘掉进度
    pi.on('before_agent_start', async event => {
      if (event.messageType !== 'user' || !todos.some(t => t.status !== 'completed')) return;
      return { message: { customType: 'todo-reminder', content: `<todos>\n当前的任务清单：\n${renderTodos(todos)}\n</todos>`, display: false } };
    });

    const restore = (ctx: ExtensionContext) => { todos = todosOnBranch(ctx); show(ctx); };
    pi.on('session_start', async (_e, ctx) => restore(ctx));
    pi.on('session_tree', async (_e, ctx) => restore(ctx));
  };
}

export default createTodoExtension();
