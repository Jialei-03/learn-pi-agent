// 第 8 章实验：完整地压缩一次——发给摘要模型的是什么，压缩前后差多少，会话文件里留下什么。
//   node labs/ch08/compact.ts
// 摘要模型是脚本，返回一份固定的摘要；重点是观察 compact() 的输入输出，以及会话怎样落盘、怎样恢复。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compact, estimateTokens } from '../../mox/src/compact.ts';
import type { Msg } from '../../mox/src/model.ts';
import { openSession } from '../../mox/src/session.ts';
import { scripted } from '../shared/scripted.ts';

const SUMMARY = '## 目标\n给 mox-notes 加上 list 命令\n\n## 进展\n- 读过 src/file1.ts、src/file2.ts，改过 src/file3.ts\n\n## 下一步\n修改 src/cli.ts';
const call = (id: string, name: string, args: object): Msg => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), name)));
const home = tmp('ch08-home-');
try {
  const session = openSession('/repo', home);
  const add = (m: Msg) => { session.messages.push(m); session.save(m); };
  for (let t = 1; t <= 4; t++) {
    add({ role: 'user', content: `第 ${t} 步：看看 src/file${t}.ts` });
    add(call(`c${t}`, t === 3 ? 'edit' : 'read', { path: `src/file${t}.ts` }));
    add({ role: 'tool', tool_call_id: `c${t}`, content: `// file${t}.ts\n` + 'x'.repeat(1600) });
    add({ role: 'assistant', content: `第 ${t} 步完成。` });
  }
  const before = session.messages.length;
  const tokensBefore = estimateTokens(session.messages);

  const summarizer = scripted([{ text: SUMMARY }]);
  const result = await compact(session.messages, summarizer, 500);
  assert.ok(result);
  session.compacted(result.summary, result.keep);

  console.log(`压缩前：${before} 条消息，约 ${tokensBefore} tokens`);
  console.log(`压缩后：${session.messages.length} 条消息，约 ${estimateTokens(session.messages)} tokens（1 条摘要 + 保留的 ${result.keep} 条）`);
  console.log(`保留部分从这里开始：${JSON.stringify(session.messages[1])}`);
  console.log(`摘要消息：${JSON.stringify(session.messages[0]).slice(0, 80)}……\n`);

  const prompt = (summarizer.requests[0].messages[0] as { content: string }).content;
  console.log(`发给摘要模型的请求：${summarizer.requests[0].messages.length} 条消息，tools=${summarizer.requests[0].tools === undefined ? '无' : '有'}，系统提示=${summarizer.requests[0].messages.some(m => m.role === 'system') ? '有' : '无'}`);
  console.log(prompt.split('\n').slice(0, 12).map(l => '  │ ' + (l.length > 74 ? l.slice(0, 74) + '…' : l)).join('\n'));
  console.log('  │ ……');

  const lines = readFileSync(session.file, 'utf8').trim().split('\n');
  console.log(`\n会话文件：${lines.length} 行 —— ${before} 条原始消息一条没少，最后多了一行 ${JSON.parse(lines.at(-1)!).type} 记录`);
  const reopened = openSession('/repo', home, true);
  console.log(`重新打开：${reopened.messages.length} 条消息，和压缩后的内存完全一致：${JSON.stringify(reopened.messages) === JSON.stringify(session.messages)}`);

  assert.equal(before, 16);
  assert.equal(session.messages.length, 5);
  assert.equal(result.keep, 4);
  assert.equal(lines.length, 17);
  assert.deepEqual(reopened.messages, session.messages);
  assert.equal(session.messages[1].role, 'user', '保留部分从用户消息开始');
  assert.ok(prompt.includes('[tool] // file1.ts'), '工具结果进入了转写文本');
} finally {
  rmSync(home, { recursive: true, force: true });
}
