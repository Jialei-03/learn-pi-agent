// 第 15 章实验：另一种沙箱——codemode。模型写一段 JavaScript，在 QuickJS 里运行，脚本能碰到的只有工具。
//   node labs/ch15/codemode.ts
// Pi 会话 + codemode + 第 12 章的 MCP 服务器（默认的 codemode 方式接入）+ 第 14 章的权限扩展。
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createCodemodeExtension, createMcpExtension, createToolSearchExtension } from '@earendil-works/pi-coding-agent';
import { createPermissionsExtension } from '../../extensions/permissions/index.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';
import { serverCommand } from '../ch12/shared.ts';

const cwd = mkdtempSync(join(tmpdir(), 'ch15-codemode-'));
writeFileSync(join(cwd, '.env'), 'DB_PASSWORD=hunter2\n');
writeFileSync(join(cwd, 'permissions.json'), JSON.stringify({ permissions: { deny: ['Read(.env)'], allow: ['mcp__issues'] } }));

const code = `// 1. 语言沙箱里没有 Node 的能力
const probe = (name, f) => { try { f(); return name + '：可用'; } catch (e) { return name + '：' + e.message; } };
text([probe('require', () => require('fs')), probe('fetch', () => fetch('https://example.com')), 'process：' + typeof process].join('\\n'));

// 2. 调用 MCP 工具，在脚本里处理结果，只把结论交给模型
const log = await tools.mcp__issues__dump_log({});
const lines = log.content[0].text.split('\\n');
text('构建日志 ' + lines.length + ' 行，最后一行：' + lines.at(-1));
const open = await tools.mcp__issues__search_issues({ query: '', state: 'open' });
text('open 的 issue：' + open.structuredContent.issues.map(i => '#' + i.id).join(' '));

// 3. 脚本里的工具调用同样要过权限检查
try { await tools.read({ path: '.env' }); } catch (e) { text('读 .env：' + e.message.split('\\n')[0]); }`;

const nested: string[] = [];
const watcher = (pi: any) => pi.on('tool_call', (e: any) => { nested.push(`${e.toolName}${e.parentToolCallId ? `（由 ${e.parentToolCallId} 发起）` : ''}`); });
const mcp = createMcpExtension({
  loadConfig: () => ({ servers: [{ name: 'issues', config: { ...serverCommand, exposure: 'codemode' }, source: 'lab', scope: 'global' }], errors: [] }),
  logPath: join(cwd, 'mcp.log'),
} as any);
const { session } = await createPiSession({
  cwd,
  extensions: [watcher, createCodemodeExtension({ models: false }), createToolSearchExtension(), mcp, createPermissionsExtension({ files: () => [{ path: join(cwd, 'permissions.json'), base: cwd }] })],
  settings: { defaultTools: ['+codemode'] },
  responses: [fauxAssistantMessage(fauxToolCall('codemode', { code }, { id: 'cm1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('好的。')],
});
await session.prompt('看看构建日志的结尾和当前 open 的 issue');
const result = session.messages.find((m: any) => m.role === 'toolResult') as any;
console.log('━━ 模型收到的 codemode 结果 ━━');
console.log(textOf(result));
console.log(`\n结果一共 ${textOf(result).length} 个字符。脚本读到的构建日志有一百多 KB，留在了沙箱里，没有进入模型的上下文。`);
console.log(`\n经过 tool_call 事件的调用：\n${nested.map(n => '  ' + n).join('\n')}`);
session.dispose();
process.exit(0);
