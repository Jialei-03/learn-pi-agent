// read 工具（第 5 章）：读文本文件，支持分段，超长时截断并告诉模型怎么继续。
// 对照 Pi：packages/coding-agent/src/core/tools/read.ts
import { readFile, stat } from 'node:fs/promises';
import type { AgentTool } from '../tools.ts';
import { resolvePath } from './paths.ts';
import { MAX_BYTES, truncateHead } from './truncate.ts';

export function createReadTool(cwd: string): AgentTool {
  return {
    name: 'read',
    replaySafe: true,                                    // 只读：崩溃后重新执行没有副作用（第 18 章）
    description: `读取文本文件的内容。输出最多 2000 行或 ${MAX_BYTES / 1024}KB（先到为准），超出时会提示用 offset 继续读。大文件请用 offset/limit 分段读取。`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对或绝对）' },
        offset: { type: 'integer', minimum: 1, description: '从第几行开始读（从 1 开始）' },
        limit: { type: 'integer', minimum: 1, description: '最多读多少行' },
      },
      required: ['path'],
    },
    async execute({ path, offset, limit }, { signal }) {
      const absolute = resolvePath(path, cwd);
      const info = await stat(absolute).catch(e => { throw new Error(`无法读取 ${path}：${e.code ?? e.message}`); });
      if (info.isDirectory()) throw new Error(`${path} 是一个目录。请用 bash 运行 ls 查看目录内容。`);
      if (signal?.aborted) throw new Error('已取消');
      const all = (await readFile(absolute, 'utf8')).split('\n');
      const start = (offset ?? 1) - 1;
      if (start >= all.length) throw new Error(`offset ${offset} 超出了文件末尾（共 ${all.length} 行）`);
      const end = limit ? Math.min(start + limit, all.length) : all.length;
      const t = truncateHead(all.slice(start, end).join('\n'));
      if (t.shownLines === 0) {
        return `[第 ${start + 1} 行就超过了 ${MAX_BYTES / 1024}KB。请用 bash：sed -n '${start + 1}p' ${path} | head -c ${MAX_BYTES}]`;
      }
      const last = start + t.shownLines;
      // 截断时给出“可以照做”的提示：下一次该用哪个 offset
      if (t.truncated) return `${t.text}\n\n[显示第 ${start + 1}-${last} 行，共 ${all.length} 行。用 offset=${last + 1} 继续读。]`;
      if (end < all.length) return `${t.text}\n\n[文件还有 ${all.length - end} 行。用 offset=${end + 1} 继续读。]`;
      return t.text;
    },
  };
}
