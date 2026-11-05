// 第 8 章实战检验：mox/src/compact.ts 和 cli.ts 里的 maybeCompact。
//   node labs/ch08/practice.ts                    检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch08/practice.ts   检验你自己写的
// 摘要模型是脚本。检验 compact() 的切点、转写、替换；再用真正的命令行（窗口调小）看触发。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, runMox } from '../shared/mox-cli.ts';
import { loadMox, whose } from '../shared/mox-dir.ts';
import { scripted } from '../shared/scripted.ts';

const { compact, estimateTokens } = await loadMox('compact.ts');
const rows: [string, string][] = [];
const check = (name: string, observed: string, ok: boolean) => { rows.push([name, `${ok ? '✓' : '✗'} ${observed}`]); assert.ok(ok, `${name}：${observed}`); };

/** n 轮对话：用户提问 → 调用 read → 工具结果（800 字符）→ 回答。 */
function conversation(turns: number) {
  const ms: any[] = [];
  for (let t = 1; t <= turns; t++) {
    ms.push({ role: 'user', content: `问题 ${t}` });
    ms.push({ role: 'assistant', content: null, tool_calls: [{ id: `c${t}`, type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: `src/file${t}.ts` }) } }] });
    ms.push({ role: 'tool', tool_call_id: `c${t}`, content: `// file${t}.ts\n` + 'x'.repeat(800) });
    ms.push({ role: 'assistant', content: `回答 ${t}` });
  }
  return ms;
}

console.log(whose() + '\n');

// 一、估算
const ascii = estimateTokens('x'.repeat(400)), chinese = estimateTokens('字'.repeat(400));
check('estimateTokens', `400 个英文字符 ≈ ${ascii}，400 个汉字 ≈ ${chinese}`, ascii < 130 && chinese > ascii * 2);

// 二、切点：保留部分从用户消息开始，工具调用和它的结果不拆开
const messages = conversation(5);
const model = scripted([{ text: '## 目标\n读文件' }]);
const result = await compact(messages, model, 600);
check('切点', `保留 ${result?.keep} 条，保留的第一条是 ${messages[1]?.role}：${String(messages[1]?.content)}`, !!result && messages[1].role === 'user' && result.keep === messages.length - 1 && result.keep % 4 === 0);
check('摘要消息', `${messages[0].role}：${JSON.stringify(messages[0].content).slice(0, 40)}…`, messages[0].role === 'user' && String(messages[0].content).includes('## 目标'));
check('就地修改', `messages 现在 ${messages.length} 条，返回的 summary 就是 messages[0]：${result?.summary === messages[0]}`, result?.summary === messages[0]);
const prompt = String((model.requests[0].messages[0] as any).content);
check('摘要请求', `${model.requests[0].messages.length} 条消息、没带工具；转写里有 [user]/[assistant]/[tool]`, model.requests[0].messages.length === 1 && !model.requests[0].tools && /\[user\] 问题 1/.test(prompt) && /\[tool\] \/\/ file1/.test(prompt) && /调用 read\(/.test(prompt));

// 三、边界
const none = await compact([], scripted([{ text: 'x' }]), 600);
check('空历史', `返回 ${none}`, none === undefined);
const one = conversation(1);
const r1 = await compact(one, scripted([{ text: '摘要' }]), 20_000);
check('只有一轮', `保留 ${r1?.keep} 条，messages 剩 ${one.length} 条（只切在用户消息前，第一条用户消息不会被留下）`, r1?.keep === 0 && one.length === 1);
const long = '很长的内容。'.repeat(500);
const clip = scripted([{ text: '摘要' }]);
await compact([{ role: 'user', content: long }, { role: 'assistant', content: '好' }, { role: 'user', content: '再来' }, { role: 'assistant', content: '好' }], clip, 5);
check('转写截断', `3000 字符的消息，转写里留下 ${(String((clip.requests[0].messages[0] as any).content).match(/很长的内容。/g) ?? []).length} 次“很长的内容。”`, (String((clip.requests[0].messages[0] as any).content).match(/很长的内容。/g) ?? []).length === 333);

// 四、触发（需要 cli.ts）
if (existsSync(CLI)) {
  const tmp = (n: string) => realpathSync(mkdtempSync(join(tmpdir(), n)));
  const home = tmp('ch08-practice-home-'), project = tmp('ch08-practice-proj-');
  writeFileSync(join(project, 'big.txt'), '这是一行日志，重复很多遍。\n'.repeat(40));
  const run = await runMox(['-p', '把 big.txt 读几遍'], {
    cwd: project, home, env: { MOX_CONTEXT_WINDOW: '4000' },
    script: request => !request.tools ? { text: '## 目标\n读文件' } : String(request.messages[1]?.content).startsWith('（更早的对话已经压缩') ? { text: '读完了。' } : { toolCalls: [{ name: 'read', arguments: { path: 'big.txt' } }] },
  });
  const summaryAt = run.requests.findIndex(r => !r.tools);
  check('命令行：窗口 4000，阈值 80%', `第 ${summaryAt + 1} 次请求是摘要请求，之后只剩 ${run.requests.at(-1)!.messages.length - 1} 条消息`, summaryAt > 1 && run.requests.at(-1)!.messages.length === 2);
  rmSync(home, { recursive: true, force: true }); rmSync(project, { recursive: true, force: true });
} else {
  rows.push(['命令行：maybeCompact', '（你的目录里还没有 src/cli.ts，跳过）']);
}

console.log('| 检查 | 观察到 |\n| --- | --- |');
for (const [name, observed] of rows) console.log(`| ${name} | ${observed} |`);
