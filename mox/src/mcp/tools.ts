// 把 MCP 工具变成 mox 的工具（第 12 章）：起名字、整理参数 schema、把结果转换成模型能读的文本。
// 对照 Pi：packages/coding-agent/src/extensions/mcp/tools.ts
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentTool, ToolResult } from '../tools.ts';
import type { CallToolResult, McpClient, McpContent, McpTool } from './client.ts';

/** 模型服务商对工具名的限制：最长 64 个字符，只能用字母、数字、下划线和连字符。 */
const MAX_NAME = 64;
export const MCP_OUTPUT_MAX_BYTES = 20 * 1024;

/**
 * mcp__服务器__工具。除字母、数字、下划线外一律换成下划线；太长或撞名时截短并加 8 位哈希。
 * 加前缀是为了不和内置工具、其他服务器的工具重名：两个服务器都提供 search 是很常见的事。
 */
export function mcpToolName(server: string, tool: string, isTaken: (name: string) => boolean = () => false): string {
  const name = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, '_');
  if (name.length <= MAX_NAME && !isTaken(name)) return name;
  const hash = createHash('sha256').update(`${server}\0${tool}`).digest('hex').slice(0, 8);
  return `${name.slice(0, MAX_NAME - hash.length - 1)}_${hash}`;
}

/** 保留开头和结尾，去掉中间。MCP 结果常常是一整段 JSON 或日志，开头（结构）和结尾（结论、错误）都重要。 */
export function truncateMiddle(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, truncated: false };
  const isBoundary = (i: number) => i >= buf.length || (buf[i] & 0xc0) !== 0x80;  // 不能切在一个字符的中间
  let headEnd = Math.floor(maxBytes / 2);
  while (headEnd > 0 && !isBoundary(headEnd)) headEnd--;
  let tailStart = buf.length - (maxBytes - Math.floor(maxBytes / 2));
  while (tailStart < buf.length && !isBoundary(tailStart)) tailStart++;
  const removed = [...buf.subarray(headEnd, tailStart).toString('utf8')].length;
  return { text: `${buf.subarray(0, headEnd).toString('utf8')}…${removed} chars truncated…${buf.subarray(tailStart).toString('utf8')}`, truncated: true };
}

function blockToText(server: string, block: McpContent): string {
  switch (block.type) {
    case 'text': return block.text;
    case 'image': return `[图片 ${block.mimeType}：mox 的工具结果只支持文本]`;
    case 'audio': return `[音频 ${block.mimeType} 已省略]`;
    case 'resource_link': return `[资源 ${block.uri} "${block.name}"${block.description ? `：${block.description}` : ''}（来自 ${server}）]`;
    case 'resource': return block.resource.text ?? `[二进制资源 ${block.resource.uri}（${block.resource.mimeType ?? '未知类型'}）已省略]`;
    default: return `[不支持的内容类型 ${(block as { type: string }).type}]`;
  }
}

/** MCP 结果 → mox 的工具结果。isError 对应工具失败；没有任何文字时补一句说明，不让模型面对空结果。 */
export function convertResult(server: string, tool: string, result: CallToolResult, saveFull = saveToTemp): ToolResult {
  let text = result.content.length > 0
    ? result.content.map(block => blockToText(server, block)).join('\n')
    : result.structuredContent !== undefined ? JSON.stringify(result.structuredContent, null, 2) : '';
  if (result.isError && !text.trim()) text = `MCP tool ${server}/${tool} returned an error`;
  const cut = truncateMiddle(text, MCP_OUTPUT_MAX_BYTES);
  if (cut.truncated) text = `${cut.text}\n\n[完整输出：${saveFull(text)}（可以用 read 分段读取）]`;
  return { content: text, isError: result.isError || undefined, details: { server, tool, structuredContent: result.structuredContent } };
}

function saveToTemp(text: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'mox-mcp-')), 'output.txt');
  writeFileSync(path, text);
  return path;
}

export function toAgentTool(server: string, tool: McpTool, name: string, client: McpClient, timeoutMs?: number): AgentTool {
  return {
    name,
    description: tool.description?.trim() || tool.title || `MCP 服务器 ${server} 的工具 ${tool.name}`,
    // 工具参数必须是 object schema；有的服务器省略 type，有的服务商拒绝没有 properties 的 object
    parameters: { ...tool.inputSchema, type: tool.inputSchema.type ?? 'object', properties: tool.inputSchema.properties ?? {} } as AgentTool['parameters'],
    async execute(args, { signal, onUpdate }) {
      const result = await client.callTool(tool.name, args, {
        signal, timeoutMs,
        onProgress: p => onUpdate?.(p.message ?? `进度 ${p.progress}${p.total ? `/${p.total}` : ''}`),
      });
      return convertResult(server, tool.name, result);
    },
  };
}
