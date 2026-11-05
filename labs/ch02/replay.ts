// 第 2 章实验：同一段 SSE 字节流，分别交给 mox 的 openai() 和 Pi 的适配器。
//   node labs/ch02/replay.ts
// 样本一：fixtures/ 里的测试样本，同一个“读 src/cli.ts”的意图写成 OpenAI 和 Anthropic 两种线上格式。
//         Anthropic 这一份只有 Pi 能读（mox 没有 Anthropic 适配器）。
// 样本二：recorded/ 里 MiniMax-M3.1-Flash 的真实回复，原样的响应体字节。
// 本地假服务把字节每 7 个切一刀再发出去，所以解码器必须自己处理被切开的行和字符。
import assert from 'node:assert/strict';
import { getModel, streamSimpleAnthropic, streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/compat';
import { openai } from '../../mox/src/model.ts';
import { startMock, type MockOptions } from './mock-server.ts';

const readFile = { name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };
const question = '入口文件在哪里？';
const piContext = { messages: [{ role: 'system', content: '你是代码助手。', toolsAdded: [readFile], timestamp: 0 }, { role: 'user', content: question, timestamp: 0 }] };

/** 各实现的结果，整理成可以逐项比较的样子。 */
interface View { text: string; calls: { id: string; name: string; args: unknown }[]; finish: string; extra?: string }

async function viaMox(files: MockOptions['files']): Promise<View> {
  const mock = await startMock({ files });
  try {
    const { message, finish } = await openai({ baseUrl: mock.url, apiKey: 'test', model: 'x' })({ messages: [{ role: 'user', content: question }], tools: [readFile] });
    return {
      text: message.content ?? '',
      calls: (message.tool_calls ?? []).map(c => ({ id: c.id, name: c.function.name, args: JSON.parse(c.function.arguments) })),
      finish,
    };
  } finally { await mock.close(); }
}

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
const header = '| 实现 | 文字 | 工具调用 | finish（原始 → Pi 归一化） | Pi 多保存的 |\n| --- | --- | --- | --- | --- |';
/** 文字和工具调用（忽略 id）是否一致 */
const sameContent = (views: View[]) => views.every(v => JSON.stringify([v.text, v.calls.map(c => [c.name, c.args])]) === JSON.stringify([views[0].text, views[0].calls.map(c => [c.name, c.args])]));

// ── 样本一 ──────────────────────────────────────────────
const fixtureOpenAI = { openai: 'fixtures/openai-tool-call.sse' }, fixtureAnthropic = { anthropic: 'fixtures/anthropic-tool-call.sse' };
const a = [await viaMox(fixtureOpenAI), await viaPi('openai', fixtureOpenAI), await viaPi('anthropic', fixtureAnthropic)];
console.log('### 样本一：测试样本（一段文字加一个工具调用，参数分三片到达）\n');
console.log(header);
console.log(row('mox · OpenAI 格式', a[0]));
console.log(row('Pi · OpenAI 格式', a[1]));
console.log(row('Pi · Anthropic 格式', a[2]));
assert.ok(sameContent(a));
console.log(`\n样本一：三个结果的文字和工具调用是否一致：${sameContent(a) ? '是' : '否'}`);

// ── 样本二 ──────────────────────────────────────────────
const recorded = { openai: 'recorded/minimax-m31-flash-stream.sse' };
const b = [await viaMox(recorded), await viaPi('openai', recorded)];
console.log('\n### 样本二：MiniMax-M3.1-Flash 的真实回复（一句话加两个工具调用）\n');
console.log(header);
console.log(row('mox · OpenAI 格式', b[0]));
console.log(row('Pi · OpenAI 格式', b[1]));
const sameIds = JSON.stringify(b[0].calls.map(c => c.id)) === JSON.stringify(b[1].calls.map(c => c.id));
assert.ok(sameContent(b) && sameIds);
console.log(`\n样本二：两个结果的文字、工具调用和 id 是否一致：${sameContent(b) && sameIds ? '是' : '否'}`);
