// 第 12 章实验：Pi 怎么应对工具太多？同一个 MCP 服务器，用 direct 和 deferred 两种方式接进 Pi。
//   node labs/ch12/pi-exposure.ts
// 真实的 Pi 会话 + Pi 内置的 MCP 扩展和 tool_search 扩展，模型是脚本。看每次请求里模型拿到了哪些工具定义。
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createMcpExtension, createToolSearchExtension } from '@earendil-works/pi-coding-agent';
import { createPiSession, textOf } from '../shared/pi-session.ts';
import { serverCommand } from './shared.ts';

async function run(exposure: 'direct' | 'deferred') {
  const cwd = mkdtempSync(join(tmpdir(), 'ch12-'));
  // 直接给出配置，而不是让扩展去读 ~/.pi/agent/mcp.json：实验不能受你本机配置的影响
  const mcp = createMcpExtension({
    loadConfig: () => ({ servers: [{ name: 'issues', config: { ...serverCommand, exposure }, source: 'lab', scope: 'global' }], errors: [] }),
    logPath: join(cwd, 'mcp.log'),
  } as any);

  // Pi 1.5 把工具定义也记在对话里：system 消息的 toolsAdded / toolsRemoved。按顺序重放，得到这次请求可用的工具
  const requests: { tools: string[]; toolChars: number; lastToolChange: number; section?: string }[] = [];
  const record = (context: any) => {
    const tools = new Map<string, any>();
    let lastToolChange = 0;
    context.messages.forEach((m: any, i: number) => {
      if (m.role !== 'system') return;
      for (const t of m.toolsRemoved ?? []) tools.delete(t.name);
      for (const t of m.toolsAdded ?? []) tools.set(t.name, t);
      if (m.toolsAdded?.length || m.toolsRemoved?.length) lastToolChange = i;
    });
    const sections = context.messages.filter((m: any) => m.role === 'system').map((m: any) => m.sections?.mcp_servers).filter(Boolean);
    requests.push({ tools: [...tools.keys()], toolChars: JSON.stringify([...tools.values()]).length, lastToolChange, section: sections.at(-1) });
  };
  const search = 'mcp__issues__search_issues';
  const responses = exposure === 'direct'
    ? [
        (c: any) => { record(c); return fauxAssistantMessage(fauxToolCall(search, { query: '压缩' }, { id: 't1' }), { stopReason: 'toolUse' }); },
        (c: any) => { record(c); return fauxAssistantMessage('找到了 #42。'); },
      ]
    : [
        (c: any) => { record(c); return fauxAssistantMessage(fauxToolCall('tool_search', { query: 'search issues by keyword', limit: 3 }, { id: 's1' }), { stopReason: 'toolUse' }); },
        (c: any) => { record(c); return fauxAssistantMessage(fauxToolCall(search, { query: '压缩' }, { id: 't1' }), { stopReason: 'toolUse' }); },
        (c: any) => { record(c); return fauxAssistantMessage('找到了 #42。'); },
      ];
  const { session } = await createPiSession({ cwd, extensions: [createToolSearchExtension(), mcp], responses });
  await session.prompt('有没有和压缩相关的 issue？');

  console.log(`━━ exposure: ${exposure} ━━`);
  requests.forEach((r, i) => {
    const mcp = r.tools.filter(t => t.startsWith('mcp__'));
    console.log(`第 ${i + 1} 次请求：${r.tools.length} 个工具定义（${r.toolChars} 字符），其中 MCP 工具 ${mcp.length} 个${mcp.length && mcp.length < 4 ? `：${mcp.join('、')}` : ''}${r.lastToolChange > 0 ? `；工具变化记在第 ${r.lastToolChange + 1} 条消息（对话末尾），开头不变` : ''}`);
    if (i === 0 && r.section) console.log(`  系统提示里的 mcp_servers 小节：\n${r.section.split('\n').map(l => '    │ ' + l).join('\n')}`);
  });
  for (const m of session.messages.filter((m: any) => m.role === 'toolResult')) {
    console.log(`  ${(m as any).toolName} → ${textOf(m).split('\n').join(' ⏎ ')}`);
  }
  session.dispose();
  console.log();

  // direct 第一次请求就带着全部 8 个 MCP 工具；deferred 第一次只有内置工具和 tool_search，
  // 搜索之后才出现匹配的 3 个工具，并且记在对话末尾
  const mcpTools = (r: (typeof requests)[number]) => r.tools.filter(t => t.startsWith('mcp__'));
  if (exposure === 'direct') {
    assert.equal(requests.length, 2);
    for (const r of requests) assert.equal(mcpTools(r).length, 8);
    assert.equal(requests[0].tools.length, 12);
  } else {
    assert.equal(requests.length, 3);
    assert.equal(mcpTools(requests[0]).length, 0);
    assert.ok(requests[0].tools.includes('tool_search'));
    assert.equal(requests[0].tools.length, 5);
    assert.equal(requests[0].section?.split('\n').length, 4, 'mcp_servers 小节：两行标签 + 两行内容');
    assert.deepEqual(mcpTools(requests[1]), ['mcp__issues__search_issues', 'mcp__issues__create_issue', 'mcp__issues__slow_count']);
    assert.ok(requests[1].lastToolChange > 0, '加载的工具记在对话末尾，开头不变');
    assert.deepEqual(requests[2].tools, requests[1].tools);
  }
}

await run('direct');
await run('deferred');
process.exit(0);
