// edit 工具（第 5 章）：用“精确文本替换”修改文件。
// 规则：每段 oldText 必须在原文件中唯一出现；多段修改都对照原文件匹配，互不重叠。
// 对照 Pi：packages/coding-agent/src/core/tools/edit.ts 与 edit-diff.ts
import { readFile, writeFile } from 'node:fs/promises';
import type { AgentTool } from '../tools.ts';
import { withFileLock } from './mutation-queue.ts';
import { resolvePath } from './paths.ts';

export interface Edit { oldText: string; newText: string }

/** 模糊匹配用的归一化：去掉行尾空白，统一弯引号、各种破折号和特殊空格。不改变行数。 */
export function normalizeFuzzy(text: string): string {
  return text
    .normalize('NFKC')
    .split('\n').map(line => line.trimEnd()).join('\n')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[  -   　]/g, ' ');
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/**
 * 把若干段替换应用到（已统一为 LF 的）文本上。
 * 先尝试精确匹配；只要有一段找不到，就整体改用归一化后的文本匹配，
 * 再只把“改动涉及的行”写回原文，其余行保留原始字节（比如别处的弯引号不会被顺手改掉）。
 */
export function applyEdits(base: string, edits: Edit[], path: string): string {
  edits.forEach((e, i) => { if (!e.oldText) throw new Error(`edits[${i}].oldText 不能为空（${path}）`); });
  const fuzzy = edits.some(e => !base.includes(e.oldText));
  const space = fuzzy ? normalizeFuzzy(base) : base;

  const matches = edits.map((e, i) => {
    const old = fuzzy ? normalizeFuzzy(e.oldText) : e.oldText;
    const index = space.indexOf(old);
    if (index === -1) throw new Error(`在 ${path} 中找不到 edits[${i}].oldText。oldText 必须与文件内容完全一致，包括空白和换行。`);
    const n = count(space, old);
    if (n > 1) throw new Error(`edits[${i}].oldText 在 ${path} 中出现了 ${n} 次，必须唯一。请多带一些上下文，让它只匹配一处。`);
    return { i, index, length: old.length, newText: e.newText };
  }).sort((a, b) => a.index - b.index);

  for (let k = 1; k < matches.length; k++) {
    if (matches[k - 1].index + matches[k - 1].length > matches[k].index) {
      throw new Error(`edits[${matches[k - 1].i}] 和 edits[${matches[k].i}] 在 ${path} 中重叠。请合并成一段，或改成互不相交的区域。`);
    }
  }

  let result: string;
  if (!fuzzy) {
    result = base;
    for (const m of [...matches].reverse()) result = result.slice(0, m.index) + m.newText + result.slice(m.index + m.length);
  } else {
    // 归一化不改变行数，所以可以按行把改动“覆盖”回原文
    const lines = base.split('\n');
    const starts = [0];
    for (let i = 0; i < space.length; i++) if (space[i] === '\n') starts.push(i + 1);
    const lineOf = (offset: number) => { let l = 0; while (l + 1 < starts.length && starts[l + 1] <= offset) l++; return l; };
    const lineEnd = (l: number) => (l + 1 < starts.length ? starts[l + 1] - 1 : space.length);
    for (const m of [...matches].reverse()) {
      const startLine = lineOf(m.index);
      const end = m.index + m.length;                     // 匹配区间的结尾（不含）
      // 匹配以换行结尾时，把下一行也纳入，它的内容会原样作为后缀保留
      const endLine = space[end - 1] === '\n' ? lineOf(end) : lineOf(end - 1);
      const segment = space.slice(starts[startLine], m.index) + m.newText + space.slice(end, lineEnd(endLine));
      lines.splice(startLine, endLine - startLine + 1, ...segment.split('\n'));
    }
    result = lines.join('\n');
  }
  if (result === base) throw new Error(`没有对 ${path} 做任何修改：替换后的内容与原来相同。`);
  return result;
}

export function createEditTool(cwd: string): AgentTool {
  return {
    name: 'edit',
    description: '用精确文本替换修改一个文件。edits 中每一段 oldText 都必须与原文件中唯一的一处内容完全一致（包括空白和换行），各段之间不能重叠；离得很近的修改请合并成一段。只修改需要改的部分，不要为了连接两处修改而包含大段未改动的内容。',
    executionMode: 'parallel',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要修改的文件路径' },
        edits: { type: 'array', items: { type: 'object', properties: { oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['oldText', 'newText'] } },
      },
      required: ['path', 'edits'],
    },
    prepareArguments(args) {
      // 兼容垫片：有的模型把数组写成 JSON 字符串，有的直接给 oldText/newText
      if (typeof args.edits === 'string') { try { args.edits = JSON.parse(args.edits as string); } catch { /* 交给校验报错 */ } }
      if (typeof args.oldText === 'string' && typeof args.newText === 'string') {
        args.edits = [...(Array.isArray(args.edits) ? args.edits : []), { oldText: args.oldText, newText: args.newText }];
        delete args.oldText; delete args.newText;
      }
      return args;
    },
    async execute({ path, edits }, { signal }) {
      const absolute = resolvePath(path, cwd);
      return withFileLock(absolute, async () => {
        if (signal?.aborted) throw new Error('已取消');
        const raw = await readFile(absolute, 'utf8').catch(e => { throw new Error(`无法编辑 ${path}：${e.code ?? e.message}`); });
        const bom = raw.startsWith('﻿') ? '﻿' : '';            // 模型不会在 oldText 里写出看不见的 BOM
        const body = raw.slice(bom.length);
        const crlf = body.includes('\r\n');
        const lf = crlf ? body.replace(/\r\n/g, '\n') : body;
        const updated = applyEdits(lf, (edits as Edit[]).map(e => ({ oldText: e.oldText.replace(/\r\n/g, '\n'), newText: e.newText.replace(/\r\n/g, '\n') })), path);
        if (signal?.aborted) throw new Error('已取消');
        await writeFile(absolute, bom + (crlf ? updated.replace(/\n/g, '\r\n') : updated));
        return { content: `已替换 ${path} 中的 ${edits.length} 处内容。`, details: { before: lf, after: updated } };
      });
    },
  };
}
