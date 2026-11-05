// 第 2 章实验：Pi 的 Anthropic 适配器怎样把 SSE 事件一个个拼成消息。
//   node labs/ch02/events.ts
// 样本是 fixtures/anthropic-tool-call.sse；本地假服务把它每 7 字节切一刀。
// 每个事件都带着 partial：适配器此刻手里的那条助手消息。看 toolcall 的 arguments 什么时候才完整。
import { getModel, streamSimpleAnthropic } from '@earendil-works/pi-ai/compat';
import { startMock } from './mock-server.ts';

const context = { messages: [{ role: 'system', content: '你是代码助手。', timestamp: 0 }, { role: 'user', content: '入口文件在哪里？', timestamp: 0 }] };
const mock = await startMock({ chunkBytes: 7 });
try {
  const model = { ...getModel('anthropic', 'claude-sonnet-4-5'), baseUrl: mock.url };
  const rows: string[] = [];
  const stream = streamSimpleAnthropic(model as any, context as any, { apiKey: 'test' });
  for await (const event of stream as AsyncIterable<any>) {
    const block = event.contentIndex !== undefined ? event.partial.content[event.contentIndex] : undefined;
    const what = event.delta !== undefined ? JSON.stringify(event.delta) : event.type === 'done' ? `stopReason=${event.reason}` : '';
    const state = block?.type === 'toolCall' ? `arguments = ${JSON.stringify(block.arguments)}${event.type === 'toolcall_end' ? '　← 参数完整，可以执行' : '（只能预览）'}` : block?.type === 'text' ? `text = ${JSON.stringify(block.text)}` : '';
    rows.push(`| ${event.type} | ${what} | ${state} |`);
  }
  console.log('| 事件 | 增量 | 此刻 partial 里的块 |\n| --- | --- | --- |');
  console.log(rows.join('\n'));
  const result: any = await stream.result();
  console.log(`\n最终消息：stopReason=${result.stopReason}（原始 ${result.rawStopReason}），输入 ${result.usage.input} / 输出 ${result.usage.output} token`);
} finally {
  await mock.close();
}
