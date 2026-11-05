// 第 2 章实验：同一段 SSE 字节流，交给 Pi 的两个适配器，看它们归一化出来的消息。
//   node labs/ch02/replay.ts
// 样本一：fixtures/ 里的测试样本，同一个“读 src/cli.ts”的意图写成 OpenAI 和 Anthropic 两种线上格式。
// 样本二：recorded/ 里 MiniMax-M3.1-Flash 的真实回复（OpenAI 格式），原样的响应体字节。
// 本地假服务把字节每 7 个切一刀再发出去，所以解码器必须自己处理被切开的行和字符。
import assert from 'node:assert/strict';
import { getModel, streamSimpleAnthropic, streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/compat';
import { startMock, type MockOptions } from './mock-server.ts';

const readFile = { name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };
const question = '入口文件在哪里？';
const piContext = { messages: [{ role: 'system', content: '你是代码助手。', toolsAdded: [readFile], timestamp: 0 }, { role: 'user', content: question, timestamp: 0 }] };

/** 各实现的结果，整理成可以逐项比较的样子。 */
interface View { text: string; calls: { id: string; name: string; args: unknown }[]; finish: string; extra?: string }

async function viaPi(api: 'openai' | 'anthropic', files: MockOptions['files']): Promise<View> {
  const mock = await startMock({ files });
  try {
    const result: any = api === 'openai'
      ? await streamSimpleOpenAICompletions({ ...getModel('openai', 'gpt-4o-mini'), api: 'openai-completions', baseUrl: mock.url } as any, piContext as any, { apiKey: 'test' }).result()
      : await streamSimpleAnthropic({ ...getModel('anthropic', 'claude-sonnet-4-5'), baseUrl: mock.url } as any, piContext as any, { apiKey: 'test' }).result();
    const thinking = result.content.filter((b: any) => b.type === 'thinking').reduce((n: number, b: any) => n + b.thinking.length, 0);
    return {
      text: result.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''),
      calls: result.content.filter((b: any) => b.type === 'toolCall').map((b: any) => ({ id: b.id, name: b.name, args: b.arguments })),
      finish: `${result.rawStopReason ?? '?'} → ${result.stopReason}`,
      extra: thinking ? `思考内容 ${thinking} 字符` : undefined,
    };
  } finally { await mock.close(); }
}

const row = (label: string, v: View) =>
  `| ${label} | ${v.text || '（无）'} | ${v.calls.map(c => `\`${c.name}(${JSON.stringify(c.args)})\``).join('<br>')} | ${v.finish} | ${v.extra ?? '—'} |`;
const header = '| 适配器 | 文字 | 工具调用 | finish（原始 → 归一化） | 另外保存的 |\n| --- | --- | --- | --- | --- |';
/** 文字和工具调用（忽略 id）是否一致 */
const sameContent = (views: View[]) => views.every(v => JSON.stringify([v.text, v.calls.map(c => [c.name, c.args])]) === JSON.stringify([views[0].text, views[0].calls.map(c => [c.name, c.args])]));

// ── 样本一 ──────────────────────────────────────────────
const fixtureOpenAI = { openai: 'fixtures/openai-tool-call.sse' }, fixtureAnthropic = { anthropic: 'fixtures/anthropic-tool-call.sse' };
const a = [await viaPi('openai', fixtureOpenAI), await viaPi('anthropic', fixtureAnthropic)];
console.log('### 样本一：测试样本（一段文字加一个工具调用，参数分三片到达）\n');
console.log(header);
console.log(row('openai-completions', a[0]));
console.log(row('anthropic-messages', a[1]));
assert.ok(sameContent(a));
console.log(`\n样本一：两个格式归一化后的文字和工具调用是否一致：${sameContent(a) ? '是' : '否'}`);

// ── 样本二 ──────────────────────────────────────────────
const recorded = { openai: 'recorded/minimax-m31-flash-stream.sse' };
const b = await viaPi('openai', recorded);
console.log('\n### 样本二：MiniMax-M3.1-Flash 的真实回复（一句话加两个工具调用，另有思考内容）\n');
console.log(header);
console.log(row('openai-completions', b));
assert.equal(b.calls.length, 2);
assert.ok(b.extra);
console.log('\n真实回复里的 `reasoning_content` 被存成了 thinking 块；两个工具调用各自带着服务端给的 id。');
