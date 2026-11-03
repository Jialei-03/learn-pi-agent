// 第 2 章实验：同一段对话，两家 API 的请求体长什么样。
//   node labs/ch02/wire.ts
// 对话：用户提问 → 模型一次调用两个工具 → 两条工具结果 → 准备第二次请求。
import { anthropicRequestBody } from '../../mox/src/providers/anthropic.ts';
import { openaiRequestBody } from '../../mox/src/providers/openai.ts';
import type { Context } from '../../mox/src/types.ts';

const context: Context = {
  systemPrompt: '你是代码助手。',
  tools: [{ name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
  messages: [
    { role: 'user', content: '比较 README 和入口文件' },
    {
      role: 'assistant',
      stopReason: 'toolUse',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      content: [
        { type: 'text', text: '我同时读两个文件。' },
        { type: 'toolCall', id: 'call_1', name: 'read_file', arguments: { path: 'README.md' } },
        { type: 'toolCall', id: 'call_2', name: 'read_file', arguments: { path: 'src/cli.ts' } },
      ],
    },
    { role: 'toolResult', toolCallId: 'call_1', toolName: 'read_file', content: '# Mox Notes …', isError: false },
    { role: 'toolResult', toolCallId: 'call_2', toolName: 'read_file', content: 'ENOENT: src/cli.ts', isError: true },
  ],
};

const { messages: a, system, tools: at } = anthropicRequestBody(context, 'claude-sonnet-4-5');
const { messages: o, tools: ot } = openaiRequestBody(context, 'gpt-4o-mini');
console.log('━━ Anthropic Messages ━━');
console.log(JSON.stringify({ system, messages: a, tools: at }, null, 2));
console.log('\n━━ OpenAI Chat Completions ━━');
console.log(JSON.stringify({ messages: o, tools: ot }, null, 2));
console.log(`\n内部消息 ${context.messages.length} 条 → Anthropic ${a.length} 条，OpenAI ${o.length} 条（含 system）`);
