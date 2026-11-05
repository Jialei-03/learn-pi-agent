// 第 2 章实验：请求失败时，Pi 的适配器不抛异常，而是返回一条 stopReason 为 error / aborted 的消息。
//   node labs/ch02/errors.ts
// 三种失败：服务端限流（429）、服务端出错（500）、用户在回复流到一半时取消。
import { getModel, streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/compat';
import { startMock, type MockOptions } from './mock-server.ts';

const context = { messages: [{ role: 'system', content: '', timestamp: 0 }, { role: 'user', content: '入口文件在哪里？', timestamp: 0 }] };
const cases: { label: string; mock: MockOptions; cancelWhenStreaming?: boolean }[] = [
  { label: '服务端限流（HTTP 429）', mock: { status: 429 } },
  { label: '服务端出错（HTTP 500）', mock: { status: 500 } },
  { label: '回复流到一半，用户取消', mock: {}, cancelWhenStreaming: true },
];

console.log('| 失败 | 适配器有没有抛异常 | 返回的消息 | 已收到的文字 |\n| --- | --- | --- | --- |');
for (const c of cases) {
  const mock = await startMock(c.mock);
  try {
    const controller = new AbortController();
    const model = { ...getModel('openai', 'gpt-4o-mini'), api: 'openai-completions' as const, baseUrl: mock.url };
    let threw = '没有';
    let result: any;
    try {
      const stream = streamSimpleOpenAICompletions(model as any, context as any, { apiKey: 'test', signal: controller.signal });
      for await (const event of stream) if (c.cancelWhenStreaming && event.type === 'text_delta') controller.abort();   // 第一段文字到达时取消
      result = await stream.result();
    } catch (e) { threw = `抛了：${(e as Error).message}`; }
    const kept = result?.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    console.log(`| ${c.label} | ${threw} | stopReason=\`${result?.stopReason}\`，errorMessage=${JSON.stringify(String(result?.errorMessage).slice(0, 50))} | ${kept ? JSON.stringify(kept) : '无'} |`);
  } finally { await mock.close(); }
}
