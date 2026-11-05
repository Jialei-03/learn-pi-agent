// 第 8 章实验：压缩在什么时候发生？真正的 mox 命令行，窗口设得很小。
//   node labs/ch08/trigger.ts
// 模型（脚本）一直要求读同一个文件。MOX_CONTEXT_WINDOW=4000，所以（历史 + 系统提示 + 工具定义）的估算超过 3200 tokens（80%）时，
// 下一次请求之前 mox 就会压缩。服务器记下每次请求：哪些是写摘要的请求，哪些是正常请求，各带多少消息。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimateTokens } from '../../mox/src/compact.ts';
import { runMox } from '../shared/mox-cli.ts';

const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), name)));
const home = tmp('ch08-home-');
const project = tmp('ch08-proj-');
writeFileSync(join(project, 'big.txt'), '这是一行日志，重复很多遍。\n'.repeat(40));

try {
  const run = await runMox(['-p', '把 big.txt 读几遍，然后告诉我读了几遍'], {
    cwd: project, home, env: { MOX_CONTEXT_WINDOW: '4000' },
    script: request => {
      if (!request.tools) return { text: '## 目标\n读 big.txt 并报告读了几遍\n\n## 进展\n已经读了若干遍，内容都是重复的日志行。\n\n## 下一步\n再读一遍，然后告诉用户读了几遍。' };
      const body = request.messages.slice(1);
      const compressed = body[0].role === 'user' && String(body[0].content).startsWith('（更早的对话已经压缩');
      return compressed ? { text: '读完了。' } : { toolCalls: [{ name: 'read', arguments: { path: 'big.txt' } }] };
    },
  });
  assert.equal(run.code, 0);

  const system = run.requests[0].messages[0].content as string;
  const toolSpecs = run.requests[0].tools!.map(t => t.function);                                  // 每次请求都带着的工具定义
  const check = (messages: unknown[]) => estimateTokens(messages) + estimateTokens(system) + estimateTokens(toolSpecs);     // 和 cli.ts 的 maybeCompact 同一个算式
  const rows = ['| 请求 | 类型 | 发出的消息数 | 压缩检查的估算 tokens（消息 + 系统提示 + 工具定义） | 之后发生了什么 |', '| --- | --- | --- | --- | --- |'];
  run.requests.forEach((r, i) => {
    const summary = !r.tools;
    const body = r.messages.slice(summary ? 0 : 1);
    const next = run.requests[i + 1];
    const what = summary ? '摘要写好，历史被替换' : !next ? '模型不再调用工具，运行结束' : !next.tools ? '工具结果追加后，估算超过 3200，下一次请求前先压缩' : '读文件，结果追加进历史';
    rows.push(`| ${i + 1} | ${summary ? '写摘要' : '正常'} | ${body.length} | ${summary ? '—' : check(body)} | ${what} |`);
  });
  console.log(rows.join('\n'));

  const dir = join(home, '.mox', 'sessions', readdirSync(join(home, '.mox', 'sessions'))[0]);
  const records = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const compactAt = records.findIndex(r => r.type === 'compact');
  const before = records.slice(0, compactAt).map(r => r.message);
  const afterSummary = run.requests.at(-1)!.messages.slice(1);

  const last = run.requests.findIndex(r => !r.tools) ;   // 第一个摘要请求的下标
  console.log(`\n第 ${last} 次请求之前，历史还在阈值之下（估算 ${check(run.requests[last - 1].messages.slice(1))}）；它的工具结果追加之后越过了阈值，所以第 ${last + 1} 次是摘要请求。`);
  console.log(`压缩前的历史：${before.length} 条消息，估算 ${check(before)} tokens，超过了 4000 × 0.8 = 3200`);
  console.log(`压缩之后的那次正常请求，发给模型的只有 ${afterSummary.length} 条消息：${afterSummary.map(m => m.role).join('、')}`);
  console.log('（整段任务只有一条用户消息，切点只能落在用户消息前，所以一条原文也没有保留。）');
  console.log(`会话文件里的记录：${records.map(r => (r.type === 'compact' ? `compact(keep=${r.keep})` : r.message.role)).join(' → ')}`);

  assert.ok(check(before) >= 3200, '压缩前超过阈值');
  assert.ok(check(run.requests[last - 1].messages.slice(1)) < 3200, '摘要请求之前的那次请求，历史还没有超过阈值');
  assert.equal(run.requests.filter(r => !r.tools).length, 1, '只压缩一次');
  assert.equal(afterSummary.length, 1);
  assert.equal(records[compactAt].keep, 0);
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
}
