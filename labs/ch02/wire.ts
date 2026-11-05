// 第 2 章实验：同一段对话，Pi 的两个适配器发出的请求体长什么样。
//   node labs/ch02/wire.ts
// 对话：用户提问 → 模型一次调用两个工具 → 两条工具结果（一条失败）→ 准备第二次请求。
//   Pi 的 openai-completions 适配器 ：把 Pi 的内部消息翻译成 OpenAI 格式
//   Pi 的 anthropic-messages 适配器 ：翻译成 Anthropic 格式
// 请求都发给本地假服务，抓下来的就是真正发出去的请求体。
import assert from 'node:assert/strict';
import { getModel, streamSimpleAnthropic, streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/compat';
import { startMock } from './mock-server.ts';

const system = '你是代码助手。';
const readFile = { name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };

// Pi 的内部消息：内容是块，参数是对象，工具结果有自己的角色和 isError
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
// （Pi 1.5 把系统提示和工具声明都放进开头那条 system 消息）
const piContext = {
  messages: [
    { role: 'system', content: system, toolsAdded: [readFile], timestamp: 0 },
    { role: 'user', content: '比较 README 和入口文件', timestamp: 0 },
    {
      role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'gpt-4o-mini', usage, stopReason: 'toolUse', timestamp: 1,
      content: [
        { type: 'text', text: '我同时读两个文件。' },
        { type: 'toolCall', id: 'call_1', name: 'read_file', arguments: { path: 'README.md' } },
        { type: 'toolCall', id: 'call_2', name: 'read_file', arguments: { path: 'src/cli.ts' } },
      ],
    },
    { role: 'toolResult', toolCallId: 'call_1', toolName: 'read_file', content: [{ type: 'text', text: '# Mox Notes …' }], isError: false, timestamp: 2 },
    { role: 'toolResult', toolCallId: 'call_2', toolName: 'read_file', content: [{ type: 'text', text: 'ENOENT: src/cli.ts' }], isError: true, timestamp: 3 },
  ],
};

const mock = await startMock();
try {
  const piOpenAI = { ...getModel('openai', 'gpt-4o-mini'), api: 'openai-completions' as const, baseUrl: mock.url };
  await streamSimpleOpenAICompletions(piOpenAI as any, piContext as any, { apiKey: 'test' }).result();
  const piAnthropic = { ...getModel('anthropic', 'claude-sonnet-4-5'), baseUrl: mock.url };
  await streamSimpleAnthropic(piAnthropic as any, piContext as any, { apiKey: 'test' }).result();

  const [openaiBody, anthropicBody] = mock.requests.map(r => r.body);
  console.log('━━ Pi · openai-completions 发出的 messages ━━');
  console.log(JSON.stringify(openaiBody.messages, null, 2));
  console.log('\n━━ Pi · anthropic-messages 发出的 system 与 messages ━━');
  console.log(JSON.stringify({ system: anthropicBody.system, messages: anthropicBody.messages }, null, 2));
  console.log('\n工具说明（tools 字段）');
  console.log('  OpenAI    ', JSON.stringify(openaiBody.tools));
  console.log('  Anthropic ', JSON.stringify(anthropicBody.tools));
  console.log(`\n同一段对话：Pi 的内部消息 ${piContext.messages.length} 条（含 system）→ OpenAI 请求 ${openaiBody.messages.length} 条；Anthropic 请求 ${anthropicBody.messages.length} 条（system 在顶层，两条结果合成了一条 user 消息）`);
} finally {
  await mock.close();
}
