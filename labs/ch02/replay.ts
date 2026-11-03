// 第 2 章实验：同一段录制的字节流，交给 mox 的两个适配器，再交给 Pi 的适配器。
//   node labs/ch02/replay.ts            对比归一化结果
//   node labs/ch02/replay.ts --events   打印流式事件（看参数怎样一段段到达）
import { anthropic } from '../../mox/src/providers/anthropic.ts';
import { openai } from '../../mox/src/providers/openai.ts';
import type { AssistantMessage, Context, StreamEvent } from '../../mox/src/types.ts';
import { getModel, streamSimpleAnthropic, streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/compat';
import { startMock } from './mock-server.ts';

const context: Context = {
  systemPrompt: '你是代码助手。',
  messages: [{ role: 'user', content: '入口文件在哪里？' }],
  tools: [{ name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
};

const showEvents = process.argv.includes('--events');
const log = (label: string) => (event: StreamEvent) => {
  if (!showEvents) return;
  if (event.type === 'toolcall_delta') console.log(`  ${label} toolcall_delta  +${JSON.stringify(event.delta).padEnd(16)} 预览 ${JSON.stringify(event.preview)}`);
  else if (event.type === 'text_delta') console.log(`  ${label} text_delta      +${JSON.stringify(event.delta)}`);
  else if (event.type === 'toolcall_end') console.log(`  ${label} toolcall_end    参数完整 ${JSON.stringify(event.toolCall.arguments)}`);
  else console.log(`  ${label} ${event.type}`);
};

// 只保留跨实现可比较的字段
const view = (m: { content: any[]; stopReason: string; usage: { input: number; output: number } }) => ({
  content: m.content.map(b => (b.type === 'text' ? { text: b.text } : { toolCall: b.name, id: b.id, arguments: b.arguments })),
  stopReason: m.stopReason,
  usage: `${m.usage.input} in / ${m.usage.output} out`,
});

const mock = await startMock({ chunkBytes: 7 });
try {
  const results: Record<string, unknown> = {};
  results['mox · Anthropic'] = view(await anthropic({ apiKey: 'test', model: 'claude-sonnet-4-5', baseUrl: mock.url }).stream(context, { onEvent: log('mox/anthropic') }));
  results['mox · OpenAI'] = view(await openai({ apiKey: 'test', model: 'gpt-4o-mini', baseUrl: mock.url }).stream(context, { onEvent: log('mox/openai   ') }));

  // Pi 使用同样的输入格式（systemPrompt + messages + tools），只是消息里多了时间戳等字段
  const piContext = {
    systemPrompt: context.systemPrompt,
    messages: [{ role: 'user' as const, content: '入口文件在哪里？', timestamp: 0 }],
    tools: context.tools,
  };
  const piAnthropic = { ...getModel('anthropic', 'claude-sonnet-4-5'), baseUrl: mock.url };
  const piOpenAI = { ...getModel('openai', 'gpt-4o-mini'), api: 'openai-completions' as const, baseUrl: mock.url };
  results['Pi · Anthropic'] = view(await streamSimpleAnthropic(piAnthropic as any, piContext as any, { apiKey: 'test' }).result() as AssistantMessage);
  results['Pi · OpenAI'] = view(await streamSimpleOpenAICompletions(piOpenAI as any, piContext as any, { apiKey: 'test' }).result() as AssistantMessage);

  for (const [label, value] of Object.entries(results)) console.log(`\n${label}\n${JSON.stringify(value, null, 2)}`);
  const contents = Object.values(results).map(r => JSON.stringify((r as any).content.map((b: any) => ({ ...b, id: undefined }))));
  console.log(`\n四个实现的 content 是否一致（忽略服务商各自的 id）：${contents.every(c => c === contents[0]) ? '是' : '否'}`);
} finally {
  await mock.close();
}
