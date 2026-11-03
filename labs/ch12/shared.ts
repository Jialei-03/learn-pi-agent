// 第 12 章实验共用：启动实验用的 MCP 服务器（labs/fixtures/mcp-server.ts）。
import { fileURLToPath } from 'node:url';
export const SERVER = fileURLToPath(new URL('../fixtures/mcp-server.ts', import.meta.url));
export const serverCommand = { command: process.execPath, args: [SERVER] };
