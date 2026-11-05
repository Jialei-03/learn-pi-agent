// 第 2 章实验：同一段对话，三份请求体长什么样。
//   node labs/ch02/wire.ts
// 对话：用户提问 → 模型一次调用两个工具 → 两条工具结果（一条失败）→ 准备第二次请求。
//   mox 的 openai()                 ：消息原样放进请求体，没有翻译
//   Pi 的 openai-completions 适配器 ：把 Pi 的内部消息翻译成 OpenAI 格式
//   Pi 的 anthropic-messages 适配器 ：翻译成 Anthropic 格式（mox 没有这一侧）
// 请求都发给本地假服务，抓下来的就是真正发出去的请求体。
import assert from 'node:assert/strict';
import { getModel, streamSimpleAnthropic, streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/compat';
import { openai, type Msg } from '../../mox/src/model.ts';
import { startMock } from './mock-server.ts';

const system = '你是代码助手。';
const readFile = { name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };

// mox 的消息：就是 OpenAI 的消息
const moxMessages: Msg[] = [
  { role: 'user', content: '比较 README 和入口文件' },
  {
    role: 'assistant', content: '我同时读两个文件。',
    tool_calls: [
      { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } },
      { id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{"path":"src/cli.ts"}' } },
    ],
  },
  { role: 'tool', tool_call_id: 'call_1', content: '# Mox Notes …' },
  { role: 'tool', tool_call_id: 'call_2', content: '错误：ENOENT: src/cli.ts' },
];

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
  await openai({ baseUrl: mock.url, apiKey: 'test', model: 'gpt-4o-mini' })({ messages: [{ role: 'system', content: system }, ...moxMessages], tools: [readFile] });
  const piOpenAI = { ...getModel('openai', 'gpt-4o-mini'), api: 'openai-completions' as const, baseUrl: mock.url };
  await streamSimpleOpenAICompletions(piOpenAI as any, piContext as any, { apiKey: 'test' }).result();
  const piAnthropic = { ...getModel('anthropic', 'claude-sonnet-4-5'), baseUrl: mock.url };
  await streamSimpleAnthropic(piAnthropic as any, piContext as any, { apiKey: 'test' }).result();

  const [moxBody, piOpenAIBody, piAnthropicBody] = mock.requests.map(r => r.body);
  // mox：请求体里的 messages 和它自己的消息数组一模一样
  assert.deepEqual(moxBody.messages, [{ role: 'system', content: system }, ...moxMessages]);

  console.log('━━ mox · openai() 发出的 messages（与内部消息逐字相同）━━');
  console.log(JSON.stringify(moxBody.messages, null, 2));
  console.log('\n━━ Pi · openai-completions 发出的 messages（翻译后）━━');
  console.log(JSON.stringify(piOpenAIBody.messages, null, 2));
  console.log('\n━━ Pi · anthropic-messages 发出的 system 与 messages（翻译后）━━');
  console.log(JSON.stringify({ system: piAnthropicBody.system, messages: piAnthropicBody.messages }, null, 2));
  console.log('\n工具说明（tools 字段）');
  console.log('  mox / OpenAI   ', JSON.stringify(moxBody.tools));
  console.log('  Pi / Anthropic ', JSON.stringify(piAnthropicBody.tools));
  console.log(`\n同一段对话：mox ${moxMessages.length + 1} 条（含 system，与内部消息相同）；Pi 的 OpenAI 请求 ${piOpenAIBody.messages.length} 条；Pi 的 Anthropic 请求 ${piAnthropicBody.messages.length} 条（system 在顶层，两条结果合成了一条 user 消息）`);
} finally {
  await mock.close();
}
