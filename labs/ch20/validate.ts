// 第 20 章实验：先测评测本身。每个任务准备三个“已知答案”的脚本 Agent：
//   正确的解（必须通过）、只说不做（必须失败）、投机取巧（必须失败）。评分器做不到这一点，评测的数字就没有意义。
//   node labs/ch20/validate.ts
import { CASES } from '../../evals/cases.ts';
import { runOnce } from '../../evals/harness.ts';
import { scripted, type ScriptReply } from '../../mox/src/providers/scripted.ts';

const edit = (path: string, oldText: string, newText: string): ScriptReply => ({ toolCalls: [{ id: 'e', name: 'edit', arguments: { path, edits: [{ oldText, newText }] } }] });
const writeFile = (path: string, content: string): ScriptReply => ({ toolCalls: [{ id: 'w', name: 'write', arguments: { path, content } }] });
const steps = (...replies: ScriptReply[]) => scripted((_c, n) => replies[n - 1] ?? { text: '完成了。' });

const agents: Record<string, Record<string, () => ReturnType<typeof scripted>>> = {
  'fix-bug': {
    正确的解: () => steps(edit('src/price.js', 'unitPrice * qty * discount', 'unitPrice * qty * (1 - discount)')),
    只说不做: () => steps({ text: '已经修好了。' }),
    投机取巧: () => steps(edit('src/price.js', 'unitPrice * qty * discount', 'unitPrice * qty')),     // 项目里的 test.js 能过，折扣却丢了
  },
  'add-function': {
    正确的解: () => steps(writeFile('src/text.js', "export function capitalize(s) {\n  return s.charAt(0).toUpperCase() + s.slice(1);\n}\n\nexport function slugify(title) {\n  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');\n}\n")),
    只说不做: () => steps({ text: '加好了。' }),
    投机取巧: () => steps(writeFile('src/text.js', "export function capitalize(s) {\n  return s.charAt(0).toUpperCase() + s.slice(1);\n}\n\nexport function slugify(title) {\n  return title.toLowerCase().replace(/ /g, '-');\n}\n")),
  },
  'stay-in-scope': {
    正确的解: () => steps(edit('README.md', 'npm instal`', 'npm install`')),
    只说不做: () => steps({ text: '改好了。' }),
    投机取巧: () => steps(edit('README.md', 'npm instal`', 'npm install`'), edit('src/index.js', '// TODO: clean up\n', '')),   // 顺手“清理”了别的文件
  },
  'answer-question': {
    正确的解: () => steps({ text: 'npm test' }),
    只说不做: () => steps({ text: '我不确定。' }),
    投机取巧: () => steps({ text: '用 vitest。' }),
  },
};

const expected = { 正确的解: true, 只说不做: false, 投机取巧: false } as const;
console.log('| 任务 | 正确的解 | 只说不做 | 投机取巧 |');
console.log('| --- | --- | --- | --- |');
let ok = 0, total = 0;
for (const c of CASES) {
  const cells: string[] = [];
  for (const kind of Object.keys(expected) as (keyof typeof expected)[]) {
    const { grade } = await runOnce(c, { name: kind }, agents[c.id][kind]());
    total++;
    if (grade.pass === expected[kind]) ok++;
    cells.push(`${grade.pass ? '通过' : '失败'}${grade.pass === expected[kind] ? '' : ' ⚠'}：${grade.note}`);
  }
  console.log(`| ${c.id} | ${cells.join(' | ')} |`);
}
console.log(`\n${ok}/${total} 个结果符合预期${ok === total ? '：评分器能区分对错' : '：评分器有问题，先修它'}`);
