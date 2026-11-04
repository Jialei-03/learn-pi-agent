// 第 19 章实验用的脚本模型（MOX_API=scripted MOX_SCRIPT=labs/ch19/script.ts）。
import type { Script } from '../../mox/src/providers/scripted.ts';

const script: Script = c => {
  const users = c.messages.filter(m => m.role === 'user');
  const results = c.messages.filter(m => m.role === 'toolResult');
  // 运行中收到插话：回应它
  if (users.length > 1 && c.messages.at(-1)?.role !== 'assistant' && users.at(-1)!.content.includes('警告')) return { text: '收到：构建输出里没有警告。' };
  // CH19_TOOL_SECONDS：bash 要跑多久，实验用它制造“运行中”的时间窗口
  if (results.length === 0) return { toolCalls: [{ id: 'b1', name: 'bash', arguments: { command: `sleep ${process.env.CH19_TOOL_SECONDS ?? '0.6'} && echo "build ok"` } }] };
  return { text: '构建完成。' };
};
export default script;
