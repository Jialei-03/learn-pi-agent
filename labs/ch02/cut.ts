// 第 2 章实验：连接在参数生成到一半时断开。
//   node labs/ch02/cut.ts
// 此时已经收到了一段文字和半个工具调用。如果适配器把“流结束”当成“正常结束”，
// 循环会以为模型说完了，用户只看到一句没头没尾的话，而且没有任何报错。
import { anthropic } from '../../mox/src/providers/anthropic.ts';
import { getModel, streamSimpleAnthropic } from '@earendil-works/pi-ai/compat';
import { readFileSync } from 'node:fs';
import { startMock } from './mock-server.ts';

const full = readFileSync(new URL('./fixtures/anthropic-tool-call.sse', import.meta.url), 'utf8');
const cutAt = Buffer.byteLength(full.slice(0, full.indexOf('th\\": \\"src/')));   // 停在 '{"pa' 之后
const context = { systemPrompt: '你是代码助手。', messages: [{ role: 'user' as const, content: '入口文件在哪里？' }], tools: [] };

const mock = await startMock({ cutAfterBytes: cutAt });
try {
  const mox = await anthropic({ apiKey: 'test', model: 'claude-sonnet-4-5', baseUrl: mock.url }).stream(context);
  const piModel = { ...getModel('anthropic', 'claude-sonnet-4-5'), baseUrl: mock.url };
  const pi = await streamSimpleAnthropic(piModel as any, { ...context, messages: [{ ...context.messages[0], timestamp: 0 }] } as any, { apiKey: 'test' }).result();
  console.log(`只发送了 ${cutAt} / ${Buffer.byteLength(full)} 字节就断开\n`);
  console.log('mox:', { stopReason: mox.stopReason, errorMessage: mox.errorMessage, 已收到的内容: mox.content });
  console.log('Pi: ', { stopReason: pi.stopReason, errorMessage: pi.errorMessage });
} finally {
  await mock.close();
}
