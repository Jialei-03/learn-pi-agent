// 第 12 章“你来改”的参考答案：给 mox 做一个“推迟加载”——系统里只放两个工具，MCP 工具按需搜索。
// 不动 mox，只用它公开的 Tool 类型：tool_search 按关键词找工具，返回名字、说明和参数；
// tool_call 按名字调用找到的工具。模型每次请求看到的工具定义只有这两个。
import type { Tool } from '../../mox/src/loop.ts';

/** 把 all 里的工具藏到两个代理工具后面。 */
export function deferredTools(all: Tool[]): Tool[] {
  return [
    {
      name: 'tool_search',
      description: `搜索可用的 MCP 工具（共 ${all.length} 个，没有直接列出）。返回匹配工具的名字、说明和参数，之后用 tool_call 调用。`,
      parameters: { type: 'object', properties: { query: { type: 'string', description: '关键词，空格分隔' } }, required: ['query'] },
      run: ({ query }: { query: string }) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const scored = all
          .map(tool => ({ tool, score: words.filter(w => `${tool.name} ${tool.description}`.toLowerCase().includes(w)).length }))
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        return scored.length ? JSON.stringify(scored.map(({ tool }) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })), null, 1) : '没有匹配的工具，换个关键词试试。';
      },
    },
    {
      name: 'tool_call',
      description: '调用 tool_search 找到的工具。',
      parameters: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name'] },
      run: ({ name, arguments: args }: { name: string; arguments?: object }, signal?: AbortSignal) => {
        const tool = all.find(t => t.name === name);
        if (!tool) throw new Error(`没有名为 ${name} 的工具，先用 tool_search 搜索`);
        return tool.run(args ?? {}, signal);
      },
    },
  ];
}
