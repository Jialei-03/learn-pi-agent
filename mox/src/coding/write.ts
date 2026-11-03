// write 工具（第 5 章）：创建或整体覆盖一个文件，自动创建上级目录。
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentTool } from '../tools.ts';
import { withFileLock } from './mutation-queue.ts';
import { resolvePath } from './paths.ts';

export function createWriteTool(cwd: string): AgentTool {
  return {
    name: 'write',
    description: '把内容写入文件。文件不存在时创建（包括上级目录），存在时整体覆盖。修改已有文件请优先用 edit。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '文件路径' }, content: { type: 'string', description: '完整的文件内容' } },
      required: ['path', 'content'],
    },
    async execute({ path, content }, { signal }) {
      const absolute = resolvePath(path, cwd);
      return withFileLock(absolute, async () => {
        if (signal?.aborted) throw new Error('已取消');
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, content);
        return `已写入 ${path}（${Buffer.byteLength(content)} 字节）。`;
      });
    },
  };
}
