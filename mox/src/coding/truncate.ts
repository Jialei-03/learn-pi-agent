// 输出截断（第 5 章）。两个上限，先到先算：行数和字节数。
// 读文件保留开头（head），命令输出保留结尾（tail）——报错信息通常在最后。
// 对照 Pi：packages/coding-agent/src/core/tools/truncate.ts
export const MAX_LINES = 2000;
export const MAX_BYTES = 50 * 1024;

export interface Truncation { text: string; truncated: boolean; totalLines: number; shownLines: number; by?: 'lines' | 'bytes' }

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

export function truncateHead(text: string, maxLines = MAX_LINES, maxBytes = MAX_BYTES): Truncation {
  const lines = text.split('\n');
  const kept: string[] = [];
  let size = 0;
  let by: Truncation['by'];
  for (const line of lines) {
    if (kept.length >= maxLines) { by = 'lines'; break; }
    if (size + bytes(line) + 1 > maxBytes) { by = 'bytes'; break; }   // 只保留完整的行
    kept.push(line);
    size += bytes(line) + 1;
  }
  return { text: kept.join('\n'), truncated: kept.length < lines.length, totalLines: lines.length, shownLines: kept.length, by };
}

export function truncateTail(text: string, maxLines = MAX_LINES, maxBytes = MAX_BYTES): Truncation {
  const lines = text.replace(/\n$/, '').split('\n');
  const kept: string[] = [];
  let size = 0;
  let by: Truncation['by'];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (kept.length >= maxLines) { by = 'lines'; break; }
    if (size + bytes(lines[i]) + 1 > maxBytes) { by = 'bytes'; break; }
    kept.unshift(lines[i]);
    size += bytes(lines[i]) + 1;
  }
  return { text: kept.join('\n'), truncated: kept.length < lines.length, totalLines: lines.length, shownLines: kept.length, by };
}
