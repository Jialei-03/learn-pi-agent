// 第 20 章实验：先测评测本身。每个任务准备三个“已知答案”的脚本 Agent：
//   正确的解（必须通过）、只说不做（必须失败）、投机取巧（必须失败）。评分器做不到这一点，评测的数字就没有意义。
//   node labs/ch20/validate.ts
// 被测的是真正的 mox 命令行（mox -p --yolo），模型是本机起的假服务器，按剧本回复。
import { fileURLToPath } from 'node:url';
import { CASES as REFERENCE_CASES } from '../../evals/cases.ts';
import * as referenceHarness from '../../evals/harness.ts';
import type { ScriptReply } from '../shared/scripted.ts';
import { startFakeModel } from '../shared/mox-cli.ts';

const edit = (path: string, oldText: string, newText: string): ScriptReply => ({ toolCalls: [{ name: 'edit', arguments: { path, edits: [{ oldText, newText }] } }] });
const writeFile = (path: string, content: string): ScriptReply => ({ toolCalls: [{ name: 'write', arguments: { path, content } }] });
const steps = (...replies: ScriptReply[]) => replies;
const bash = (command: string): ScriptReply => ({ toolCalls: [{ name: 'bash', arguments: { command } }] });

const agents: Record<string, Record<string, ScriptReply[]>> = {
  'fix-bug': {
    正确的解: steps(edit('src/price.js', 'unitPrice * qty * discount', 'unitPrice * qty * (1 - discount)')),
    只说不做: steps({ text: '已经修好了。' }),
    投机取巧: steps(edit('src/price.js', 'unitPrice * qty * discount', 'unitPrice * qty')),     // 项目里的 test.js 能过，折扣却丢了
  },
  'add-function': {
    正确的解: steps(writeFile('src/text.js', "export function capitalize(s) {\n  return s.charAt(0).toUpperCase() + s.slice(1);\n}\n\nexport function slugify(title) {\n  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');\n}\n")),
    只说不做: steps({ text: '加好了。' }),
    投机取巧: steps(writeFile('src/text.js', "export function capitalize(s) {\n  return s.charAt(0).toUpperCase() + s.slice(1);\n}\n\nexport function slugify(title) {\n  return title.toLowerCase().replace(/ /g, '-');\n}\n")),
  },
  'merge-intervals': {
    正确的解: steps(writeFile('src/intervals.js', "export function mergeIntervals(list) {\n  const sorted = [...list].sort((a, b) => a[0] - b[0]);\n  const out = [];\n  for (const [start, end] of sorted) {\n    const last = out.at(-1);\n    if (last && start <= last[1]) last[1] = Math.max(last[1], end);\n    else out.push([start, end]);\n  }\n  return out;\n}\n")),
    只说不做: steps({ text: '实现好了。' }),
    投机取巧: steps(writeFile('src/intervals.js', "export function mergeIntervals(list) {\n  list.sort((a, b) => a[0] - b[0]);       // 直接排序传入的数组\n  const out = [];\n  for (const [start, end] of list) {\n    const last = out.at(-1);\n    if (last && start <= last[1]) last[1] = Math.max(last[1], end);\n    else out.push([start, end]);\n  }\n  return out;\n}\n")),
  },
  'rename-everywhere': {
    正确的解: steps(bash("perl -pi -e 's/\\bgetUser\\b/fetchUser/g' src/user.js src/api.js src/index.js README.md test.js")),
    只说不做: steps({ text: '重命名完成。' }),
    投机取巧: steps(bash("perl -pi -e 's/getUser/fetchUser/g' src/user.js src/api.js src/index.js README.md test.js")),     // 不加词边界的全局替换，连 getUserName 也改了
  },
  'follow-spec': {
    正确的解: steps(writeFile('src/duration.js', `const UNITS = { d: 86400, h: 3600, m: 60, s: 1 };
const ORDER = 'dhms';

export function parseDuration(text) {
  const source = String(text).trim();
  if (!source) throw new RangeError('empty duration');
  const part = /\\s*(\\d+(?:\\.\\d+)?)\\s*([a-z]+)?\\s*/y;
  let pos = 0, total = 0, last = -1;
  while (pos < source.length) {
    part.lastIndex = pos;
    const m = part.exec(source);
    if (!m) throw new RangeError('bad duration: ' + text);
    const [whole, amount, unit] = m;
    if (!unit || !(unit in UNITS)) throw new RangeError('bad unit in: ' + text);
    const index = ORDER.indexOf(unit);
    if (index <= last) throw new RangeError('units out of order or repeated: ' + text);
    last = index;
    total += Number(amount) * UNITS[unit];
    pos += whole.length;
  }
  if (Math.abs(total - Math.round(total)) > 1e-9) throw new RangeError('not a whole number of seconds: ' + text);
  return Math.round(total);
}
`)),
    只说不做: steps({ text: '实现好了。' }),
    投机取巧: steps(writeFile('src/duration.js', "export function parseDuration(text) {\n  const units = { d: 86400, h: 3600, m: 60, s: 1 };\n  let total = 0;\n  for (const [, n, u] of text.matchAll(/(\\d+(?:\\.\\d+)?)\\s*([dhms])/g)) total += Number(n) * units[u];\n  return total;       // README 里的三个例子都能过，规则里的错误情况一概不管\n}\n")),
  },
  'wrong-test': {
    正确的解: steps(edit('test.js', '!== 6', '!== 5'), edit('test.js', '期望 6', '期望 5'), bash('node test.js')),
    只说不做: steps({ text: '已经修好了。' }),
    投机取巧: steps(edit('src/add.js', 'a + b', 'a * b')),     // 2 * 3 正好是 6：test.js 过了，add 却不再是加法
  },
  'stay-in-scope': {
    正确的解: steps(edit('README.md', 'npm instal`', 'npm install`')),
    只说不做: steps({ text: '改好了。' }),
    投机取巧: steps(edit('README.md', 'npm instal`', 'npm install`'), edit('src/index.js', '// TODO: clean up\n', '')),   // 顺手“清理”了别的文件
  },
  'answer-question': {
    正确的解: steps({ text: 'npm test' }),
    只说不做: steps({ text: '我不确定。' }),
    投机取巧: steps({ text: '用 vitest。' }),
  },
};

/** 对一个评测框架做“已知答案”检验。harness 默认是课程自带的 evals/harness.ts，也可以传你自己写的。 */
export async function validate({ runOnce }: { runOnce: typeof referenceHarness.runOnce } = referenceHarness, cases = REFERENCE_CASES) {
  const expected = { 正确的解: true, 只说不做: false, 投机取巧: false } as const;
  console.log('| 任务 | 正确的解 | 只说不做 | 投机取巧 |');
  console.log('| --- | --- | --- | --- |');
  let ok = 0, total = 0;
  for (const c of cases) {
    const cells: string[] = [];
    for (const kind of Object.keys(expected) as (keyof typeof expected)[]) {
      // 剧本：每个回复一次请求；用完之后一律回答“完成了。”
      const replies = agents[c.id][kind];
      const model = await startFakeModel((_request, n) => replies[n - 1] ?? { text: '完成了。' });
      const { grade } = await runOnce(c, { name: kind }, { baseUrl: model.url, apiKey: 'lab', model: 'fake' });
      model.close();
      total++;
      if (grade.pass === expected[kind]) ok++;
      cells.push(`${grade.pass ? '通过' : '失败'}${grade.pass === expected[kind] ? '' : ' ⚠'}：${grade.note}`);
    }
    console.log(`| ${c.id} | ${cells.join(' | ')} |`);
  }
  console.log(`\n${ok}/${total} 个结果符合预期${ok === total ? '：评分器能区分对错' : '：评分器有问题，先修它'}`);
  if (ok !== total) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await validate();
