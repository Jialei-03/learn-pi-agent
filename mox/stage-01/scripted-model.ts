// 脚本模型：没有 API Key 时代替真实模型。
// 它返回的 JSON 与 OpenAI Chat Completions 的 message 字段格式相同，
// 所以 agent.ts 里的循环完全不知道自己面对的是脚本还是真模型。
// 决策规则是写死的：先列目录，看到 README.md 就读它，读完就回答。
import type { CallModel } from './agent.ts';

let nextId = 1;
const toolCall = (name: string, args: object) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id: `call_${nextId++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});

export const scriptedModel: CallModel = async messages => {
  const results = messages.filter(m => m.role === 'tool');
  if (results.length === 0) return toolCall('list_dir', { path: '.' });

  const listing = results[0].content as string;
  if (results.length === 1) {
    if (listing.split('\n').includes('README.md')) return toolCall('read_file', { path: 'README.md' });
    return { role: 'assistant', content: '这个目录里没有 README.md，我无法判断项目用途。' };
  }

  const readme = results[1].content as string;
  const summary = readme.split('\n').find(line => line.trim() && !line.startsWith('#')) ?? '（README 里没有说明段落）';
  return { role: 'assistant', content: `根据 README.md：${summary.trim()}` };
};
