// 第 12 章实验：推迟加载的参考实现（tool-search.ts）跑一遍真正的 runLoop。
//   node labs/ch12/deferred.ts
// 6 个 issue 服务器，共 48 个 MCP 工具。对比两种接法：全部直接给模型，或者只给 tool_search / tool_call。
import assert from 'node:assert/strict';
import { estimateTokens } from '../../mox/src/compact.ts';
import { runLoop, type Event } from '../../mox/src/loop.ts';
import { connectMcp } from '../../mox/src/mcp.ts';
import { scripted } from '../shared/scripted.ts';
import { serverCommand } from './shared.ts';
import { deferredTools } from './tool-search.ts';

const mcp = await connectMcp(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`issues${i + 1}`, serverCommand])));
try {
  const script = (name: string) => [
    { toolCalls: [{ name: 'tool_search', arguments: { query: 'search issues keyword' } }] },
    { toolCalls: [{ name: 'tool_call', arguments: { name, arguments: { query: '压缩' } } }] },
    { text: '找到了 #42。' },
  ];

  // ── 直接给：48 个工具每次请求都带着 ──
  const direct = scripted([{ toolCalls: [{ name: 'mcp__issues1__search_issues', arguments: { query: '压缩' } }] }, { text: '找到了 #42。' }]);
  await runLoop([{ role: 'user', content: '有没有和压缩相关的 issue？' }], { model: direct, system: '', tools: mcp.tools });

  // ── 推迟加载：只有两个代理工具 ──
  const deferred = scripted(script('mcp__issues1__search_issues'));
  const events: string[] = [];
  const onEvent = (e: Event) => { if (e.type === 'tool_end') events.push(`${e.call.function.name} → ${e.result.replace(/\s+/g, ' ').slice(0, 70)}…`); };
  const messages: Parameters<typeof runLoop>[0] = [{ role: 'user', content: '有没有和压缩相关的 issue？' }];
  await runLoop(messages, { model: deferred, system: '', tools: deferredTools(mcp.tools), onEvent });

  const cost = (model: ReturnType<typeof scripted>) => model.requests.map(r => `${r.tools!.length} 个工具 / 约 ${estimateTokens(r.tools)} tokens`);
  console.log('| 接法 | 第 1 次请求 | 第 2 次请求 | 第 3 次请求 |');
  console.log('| --- | --- | --- | --- |');
  console.log(`| 全部直接给 | ${cost(direct)[0]} | ${cost(direct)[1]} | — |`);
  console.log(`| tool_search + tool_call | ${cost(deferred).join(' | ')} |`);
  console.log('\n推迟加载时，模型这一次实际经历的调用：');
  events.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  const finalTool = messages.filter(m => m.role === 'tool').at(-1)!;
  console.log(`\n最后一个工具结果（真正的 MCP 调用）：${JSON.stringify(finalTool.content)}`);

  assert.equal(direct.requests[0].tools!.length, 48);
  assert.equal(deferred.requests[0].tools!.length, 2);
  assert.equal(finalTool.content, '#42 [open] 压缩后丢失文件列表');
} finally {
  mcp.close();
}
