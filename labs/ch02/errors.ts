// 第 2 章实验：请求失败时，mox 抛异常，Pi 的适配器返回一条 stopReason 为 error 的消息。
//   node labs/ch02/errors.ts
// 三种失败：服务端限流（429）、服务端出错（500）、用户在回复流到一半时取消。
// 要看的问题：失败之后，调用方拿到什么？对话历史里留下了什么？
import { getModel, streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/compat';
import { runLoop } from '../../mox/src/loop.ts';
import { openai, type Msg } from '../../mox/src/model.ts';
import { startMock, type MockOptions } from './mock-server.ts';

const question = '入口文件在哪里？';
const piModel = (baseUrl: string) => ({ ...getModel('openai', 'gpt-4o-mini'), api: 'openai-completions' as const, baseUrl });
const piContext = { messages: [{ role: 'system', content: '', timestamp: 0 }, { role: 'user', content: question, timestamp: 0 }] };

const cases: { label: string; mock: MockOptions; cancelWhenStreaming?: boolean }[] = [
  { label: '服务端限流（HTTP 429）', mock: { status: 429 } },
  { label: '服务端出错（HTTP 500）', mock: { status: 500 } },
  { label: '回复流到一半，用户取消', mock: {}, cancelWhenStreaming: true },
];

console.log('| 失败 | mox：runLoop 的结局 | mox：历史里有什么 | mox：屏幕上已经流出的文字 | Pi：适配器返回 |\n| --- | --- | --- | --- | --- |');
for (const c of cases) {
  // mox：模型调用抛出的异常会一直冒出 runLoop
  const mock = await startMock(c.mock);
  try {
    const messages: Msg[] = [{ role: 'user', content: question }];
    const controller = new AbortController();
    let shown = '';
    let outcome: string;
    try {
      await runLoop(messages, {
        model: openai({ baseUrl: mock.url, apiKey: 'test', model: 'x' }), system: '', tools: [], signal: controller.signal,
        onEvent: e => { if (e.type === 'text') { shown += e.text; if (c.cancelWhenStreaming) controller.abort(); } },
      });
      outcome = '正常返回';
    } catch (e) {
      outcome = `抛出异常：${(e as Error).name === 'Error' ? (e as Error).message.split('：')[0] : `${(e as Error).name}`}`;
    }
    // Pi：错误被写进消息里，作为返回值交给调用方
    const piController = new AbortController();
    const piMock = await startMock(c.mock);
    try {
      const stream = streamSimpleOpenAICompletions(piModel(piMock.url) as any, piContext as any, { apiKey: 'test', signal: piController.signal });
      for await (const event of stream) if (c.cancelWhenStreaming && event.type === 'text_delta') piController.abort();   // 第一段文字到达时取消
      const result: any = await stream.result();
      const kept = result.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      console.log(`| ${c.label} | ${outcome} | ${messages.length} 条（${messages.map(m => m.role).join('、')}） | ${shown ? JSON.stringify(shown) : '无'} | 返回消息：stopReason=\`${result.stopReason}\`${result.errorMessage ? `，errorMessage=${JSON.stringify(result.errorMessage.slice(0, 40))}` : ''}${kept ? `，保留文字 ${JSON.stringify(kept)}` : ''} |`);
    } finally { await piMock.close(); }
  } finally { await mock.close(); }
}
