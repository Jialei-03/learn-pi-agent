// mox 的 MCP 支持（第 12 章）：读配置、连接服务器、把它们的工具注册成 mox 的工具。
// 和 Pi 一样，它是一个“内置扩展”：用的就是第 9 章的扩展 API，没有在内核里加任何特殊逻辑。
// 配置格式与 Claude Code、Pi、Cursor 通用：{ "mcpServers": { "名字": { "command": "...", "args": [...], "env": {...} } } }
// 对照 Pi：packages/coding-agent/src/extensions/mcp/（index.ts、config.ts）
import { existsSync, readFileSync } from 'node:fs';
import type { MoxExtension } from '../extensions.ts';
import { McpClient } from './client.ts';
import { mcpToolName, toAgentTool } from './tools.ts';
import { StdioTransport } from './transport.ts';

export interface McpServerConfig { command: string; args?: string[]; env?: Record<string, string>; cwd?: string; timeout?: number; enabled?: boolean }
export interface McpServerEntry { name: string; config: McpServerConfig; source: string }

/** 后面的文件覆盖前面的同名服务器：先传用户级配置，再传项目级配置。 */
export function loadMcpConfig(paths: string[]): { servers: McpServerEntry[]; errors: string[] } {
  const byName = new Map<string, McpServerEntry>();
  const errors: string[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    let parsed: any;
    try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch (error) { errors.push(`${path}：${(error as Error).message}`); continue; }
    for (const [name, raw] of Object.entries<any>(parsed.mcpServers ?? {})) {
      // 一个配置写错了，跳过它，不影响其他服务器
      if (!/^[A-Za-z0-9_-]+$/.test(name)) { errors.push(`${path}：服务器名 "${name}" 只能包含字母、数字、_ 和 -`); continue; }
      if (raw.url) { errors.push(`${path}：${name} 是远程服务器，mox 只实现了 stdio`); continue; }
      if (typeof raw.command !== 'string') { errors.push(`${path}：${name} 缺少 command`); continue; }
      // ${VAR} 从环境变量取值：密钥不必写进配置文件
      const env = Object.fromEntries(Object.entries<string>(raw.env ?? {}).map(([k, v]) => [k, v.replace(/\$\{(\w+)\}/g, (_, n) => process.env[n] ?? '')]));
      byName.set(name, { name, source: path, config: { ...raw, env } });
    }
  }
  return { servers: [...byName.values()], errors };
}

export interface McpExtensionOptions {
  /** 启动时最多等多久；超时的服务器跳过，不拖住整个 Agent。 */
  connectTimeoutMs?: number;
  onStatus?: (message: string) => void;
}

export function createMcpExtension(servers: McpServerEntry[], options: McpExtensionOptions = {}): MoxExtension {
  return async api => {
    const status = options.onStatus ?? (() => {});
    const clients: McpClient[] = [];
    const instructions: string[] = [];

    const connectOne = async ({ name, config }: McpServerEntry) => {
      const transport = new StdioTransport({ command: config.command, args: config.args, env: config.env, cwd: config.cwd });
      const client = new McpClient(transport, { timeoutMs: (config.timeout ?? 60) * 1000 });
      client.onError = error => status(`[mcp:${name}] ${error.message}`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.connect(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${options.connectTimeoutMs ?? 10_000}ms 内没有完成握手`)), options.connectTimeoutMs ?? 10_000); }),
        ]);
      } catch (error) {
        await client.close();
        const stderr = transport.stderr.trim().split('\n').slice(-3).join(' | ');
        status(`[mcp:${name}] 连接失败：${(error as Error).message}${stderr ? `（stderr：${stderr}）` : ''}`);
        return;
      } finally { clearTimeout(timer); }
      clients.push(client);
      if (client.instructions) instructions.push(`- ${name}：${client.instructions.trim().split('\n')[0]}`);

      // 服务器当前提供的工具。工具列表变化后，已经下线的工具调用时返回错误，新工具注册进来
      let offered = new Set<string>();
      const registered = new Set<string>();
      const sync = async () => {
        const tools = await client.listTools();
        offered = new Set(tools.map(t => t.name));
        for (const tool of tools) {
          if (registered.has(tool.name)) continue;
          registered.add(tool.name);
          const agentTool = toAgentTool(name, tool, mcpToolName(name, tool.name, n => api.hasTool(n)), client);
          const execute = agentTool.execute;
          api.registerTool({
            ...agentTool,
            execute: (args, ctx) => offered.has(tool.name) ? execute(args, ctx) : { content: `MCP 工具 ${name}/${tool.name} 已不再提供`, isError: true },
          });
        }
      };
      await sync();
      client.onNotification('notifications/tools/list_changed', () => {
        sync().then(() => status(`[mcp:${name}] 工具列表已更新`)).catch(error => status(`[mcp:${name}] 刷新工具失败：${error.message}`));
      });
      status(`[mcp:${name}] 已连接 ${client.serverInfo?.name ?? ''}，${offered.size} 个工具`);
    };

    // 并行连接：一个慢服务器不该让其他服务器排队
    await Promise.all(servers.filter(s => s.config.enabled !== false).map(connectOne));

    // 服务器的说明（initialize 返回的 instructions）作为系统提示的一个小节；内容不变，前缀就稳定
    if (instructions.length) {
      api.on('before_agent_start', event => ({ systemPrompt: `${event.systemPrompt}\n\n# MCP 服务器\n${instructions.join('\n')}` }));
    }
    // 服务器是子进程：不关掉它们，管道会让 mox 进程一直无法退出
    api.on('session_shutdown', async () => { await Promise.all(clients.map(c => c.close())); });
  };
}
