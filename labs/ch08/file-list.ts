// 第 8 章“你来改”的参考答案：给 mox 的压缩补上“文件清单”。
//   node labs/ch08/file-list.ts
// Pi 不让模型去记“改过哪些文件”，而是从工具调用里直接提取，附在摘要末尾。mox 没有这一步。
// 这里不动 mox：包装一下 compact()，在它返回的摘要后面追加清单。compact 就地修改 messages，
// 返回的 summary 就是 messages[0] 同一个对象，所以改它，内存里的历史和写进会话的记录一起变。
import assert from 'node:assert/strict';
import { compact } from '../../mox/src/compact.ts';
import type { Model, Msg } from '../../mox/src/model.ts';
import { scripted } from '../shared/scripted.ts';

/** 从一段消息的工具调用里提取读过和改过的文件。 */
export function fileOps(messages: Msg[]) {
  const read = new Set<string>(), modified = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const call of m.tool_calls ?? []) {
      const path = JSON.parse(call.function.arguments || '{}').path;
      if (typeof path !== 'string') continue;
      (call.function.name === 'read' ? read : ['edit', 'write'].includes(call.function.name) ? modified : new Set()).add(path);
    }
  }
  for (const path of modified) read.delete(path);
  return { read: [...read].sort(), modified: [...modified].sort() };
}

export async function compactWithFiles(messages: Msg[], model: Model, keepTokens: number) {
  const before = messages.slice();
  const result = await compact(messages, model, keepTokens);
  if (!result) return result;
  const { read, modified } = fileOps(before.slice(0, before.length - result.keep));      // 只统计被摘要掉的那一段
  const block = (tag: string, files: string[]) => (files.length ? `\n\n<${tag}>\n${files.join('\n')}\n</${tag}>` : '');
  result.summary.content += block('read-files', read) + block('modified-files', modified);
  return result;
}

// ── 运行 ──
const call = (id: string, name: string, path: string): Msg => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify({ path }) } }] });
const messages: Msg[] = [];
for (const [t, name] of [[1, 'read'], [2, 'read'], [3, 'edit'], [4, 'read']] as const) {
  messages.push({ role: 'user', content: `第 ${t} 步` }, call(`c${t}`, name, `src/file${t}.ts`), { role: 'tool', tool_call_id: `c${t}`, content: 'x'.repeat(1600) }, { role: 'assistant', content: `第 ${t} 步完成。` });
}
const result = await compactWithFiles(messages, scripted([{ text: '## 目标\n给 mox-notes 加上 list 命令' }]), 500);
console.log('摘要消息的全文：');
console.log((messages[0].content as string).split('\n').map(l => '  │ ' + l).join('\n'));
console.log(`\n被摘要的是前 ${16 - result!.keep} 条消息，所以只列出了第 1～3 步碰过的文件；第 4 步读的 src/file4.ts 还在保留的原文里，不需要列。`);
assert.ok((messages[0].content as string).includes('<read-files>\nsrc/file1.ts\nsrc/file2.ts\n</read-files>'));
assert.ok((messages[0].content as string).includes('<modified-files>\nsrc/file3.ts\n</modified-files>'));
assert.ok(!(messages[0].content as string).includes('file4'));
