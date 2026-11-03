// 第 12 章实验用的 MCP 服务器：一个假的 issue 系统。不依赖任何 SDK，手写协议，方便看清服务端在做什么。
//   node labs/fixtures/mcp-server.ts
// 协议：stdin 每行一条 JSON-RPC 消息进，stdout 每行一条出。日志只能写 stderr——stdout 是协议通道。
// 环境变量：MCP_FIXTURE_NOISY=1 启动时往 stdout 打一行普通日志（错误示范）；MCP_FIXTURE_PAGE_SIZE=n 分页返回工具列表。
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

type Json = Record<string, any>;
const send = (message: Json) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const log = (text: string) => process.stderr.write(`[issues] ${text}\n`);

const issues = [
  { id: 41, title: 'mox -p 模式下 Ctrl+C 不退出', state: 'open', labels: ['bug'] },
  { id: 42, title: '压缩后丢失文件列表', state: 'open', labels: ['bug', 'compaction'] },
  { id: 43, title: '支持 MCP', state: 'open', labels: ['feature'] },
  { id: 40, title: '读取大文件时卡顿', state: 'closed', labels: ['perf'] },
];

const tools: Json[] = [
  {
    name: 'search_issues', title: '搜索 issue',
    description: '按关键词搜索 issue。返回编号、标题和状态。',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: '关键词，空字符串表示全部' }, state: { type: 'string', enum: ['open', 'closed', 'all'] } }, required: ['query'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create-issue', description: '新建一个 issue。',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } }, required: ['title'] },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'slow_count', description: '慢慢地从 1 数到 n，每数一个报告一次进度（用来演示超时、进度和取消）。',
    inputSchema: { type: 'object', properties: { to: { type: 'number' }, delayMs: { type: 'number' } }, required: ['to'] },
  },
  { name: 'dump_log', description: '返回一份很长的构建日志。', inputSchema: { type: 'object', properties: {} } },
  { name: 'fail', description: '总是失败。', inputSchema: { type: 'object', properties: {} } },
  { name: 'crash', description: '服务器直接退出（演示连接中断）。', inputSchema: { type: 'object', properties: {} } },
  { name: 'spawn_worker', description: '启动一个后台子进程（演示关闭时清理进程组）。', inputSchema: { type: 'object', properties: {} } },
  { name: 'enable_admin_tools', description: '开启管理工具（演示工具列表变化通知）。', inputSchema: { type: 'object', properties: {} } },
];
const adminTool = {
  name: 'delete_issue', description: '永久删除一个 issue。',
  inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
  annotations: { destructiveHint: true },
};

const running = new Map<string | number, AbortController>();
const text = (t: string) => ({ content: [{ type: 'text', text: t }] });

async function callTool(id: string | number, name: string, args: Json, meta: Json | undefined): Promise<Json> {
  switch (name) {
    case 'search_issues': {
      const q = String(args.query ?? '');
      const state = args.state ?? 'open';
      const found = issues.filter(i => (state === 'all' || i.state === state) && i.title.includes(q));
      return { ...text(found.map(i => `#${i.id} [${i.state}] ${i.title}`).join('\n') || '没有匹配的 issue'), structuredContent: { issues: found } };
    }
    case 'create-issue': {
      const issue = { id: 44 + issues.length - 4, title: String(args.title), state: 'open', labels: args.labels ?? [] };
      issues.push(issue);
      return text(`已创建 #${issue.id}`);
    }
    case 'slow_count': {
      const controller = new AbortController();
      running.set(id, controller);
      try {
        for (let i = 1; i <= Number(args.to); i++) {
          await new Promise(r => setTimeout(r, Number(args.delayMs ?? 200)));
          if (controller.signal.aborted) { log(`请求 ${id} 被取消，停止计数（数到 ${i}）`); return text('cancelled'); }
          if (meta?.progressToken !== undefined) {
            send({ method: 'notifications/progress', params: { progressToken: meta.progressToken, progress: i, total: Number(args.to), message: `数到 ${i}` } });
          }
        }
        return text(`数完了：${args.to}`);
      } finally { running.delete(id); }
    }
    case 'dump_log':
      return text(Array.from({ length: 3000 }, (_, i) => `[${String(i).padStart(4, '0')}] compile src/module-${i}.ts ... ok`).join('\n'));
    case 'fail':
      return { content: [], isError: true };
    case 'crash':
      log('收到 crash，直接退出');
      process.exit(1);
    case 'spawn_worker': {
      const child = spawn('sleep', ['30'], { stdio: 'ignore' });
      return text(`worker pid ${child.pid}`);
    }
    case 'enable_admin_tools':
      if (!tools.includes(adminTool)) tools.push(adminTool);
      send({ method: 'notifications/tools/list_changed' });
      return text('已开启管理工具');
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

async function handle(message: Json) {
  const { id, method, params } = message;
  if (id === undefined) {                       // 通知：没有 id，不需要回复
    if (method === 'notifications/cancelled') running.get(params?.requestId)?.abort();
    return;
  }
  if (!method) return;                          // 客户端发来的响应（回复我们的 ping），这里不需要
  try {
    let result: Json;
    if (method === 'initialize') {
      result = {
        protocolVersion: params.protocolVersion === '2025-11-25' ? '2025-11-25' : '2025-06-18',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'issues', version: '0.1.0' },
        instructions: 'mox 项目的 issue 系统。新建 issue 之前先用 search_issues 查重。',
      };
    } else if (method === 'ping') {
      result = {};
    } else if (method === 'tools/list') {
      const size = Number(process.env.MCP_FIXTURE_PAGE_SIZE ?? tools.length);
      const start = Number(params?.cursor ?? 0);
      const page = tools.slice(start, start + size);
      result = { tools: page, ...(start + size < tools.length ? { nextCursor: String(start + size) } : {}) };
    } else if (method === 'tools/call') {
      result = await callTool(id, params.name, params.arguments ?? {}, params._meta);
    } else {
      send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
      return;
    }
    send({ id, result });
  } catch (error: any) {
    send({ id, error: { code: error.code ?? -32603, message: error.message } });
  }
}

if (process.env.MCP_FIXTURE_NOISY) console.log('issues server starting...');   // 错误示范：日志写进了 stdout
createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  try { void handle(JSON.parse(line)); } catch { send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
}).on('close', () => { log('stdin 关闭，退出'); process.exit(0); });
