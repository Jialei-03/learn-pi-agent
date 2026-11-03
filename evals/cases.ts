// 第 20 章的评测任务。每个任务：布置现场、给出提示、按最终状态评分。
// 评分尽量用“隐藏的测试”：模型看不到评分用的测试，只能真正把事做对，而不是去迎合某个测试文件。
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalCase } from './harness.ts';

const write = (dir: string, path: string, text: string) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text); };
const node = (dir: string, code: string) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, encoding: 'utf8' });
/** 失败时给出最有用的一行：测试自己的输出，或者报错信息里写着 Error 的那一行 */
const reason = (r: { stdout: string; stderr: string }) => r.stdout.trim() || r.stderr.split('\n').find(l => /Error/.test(l))?.trim() || r.stderr.trim().split('\n')[0];
const changedFiles = (dir: string) => execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' }).split('\n').filter(Boolean).map(l => l.slice(3));

export const CASES: EvalCase[] = [
  {
    id: 'fix-bug',
    prompt: 'src/price.js 里的 total 函数算错了折扣，修好它。',
    setup: dir => {
      write(dir, 'package.json', '{"type":"module","scripts":{"test":"node test.js"}}');
      write(dir, 'src/price.js', '// 按数量和折扣率（0~1）计算总价\nexport function total(unitPrice, qty, discount = 0) {\n  return unitPrice * qty * discount;\n}\n');
      write(dir, 'test.js', "import { total } from './src/price.js';\nif (total(10, 2) !== 20) throw new Error('total(10, 2) 应该是 20');\nconsole.log('ok');\n");
    },
    grade: dir => {
      // 隐藏测试：比项目里的 test.js 更严格，覆盖有折扣的情况
      const r = node(dir, "import { total } from './src/price.js'; const c = [[10,2,0,20],[10,2,0.25,15],[8,5,0.5,20]]; for (const [u,q,d,e] of c) if (Math.abs(total(u,q,d) - e) > 1e-9) { console.log(`total(${u},${q},${d}) = ${total(u,q,d)}，期望 ${e}`); process.exit(1); }");
      return { pass: r.status === 0, note: r.status === 0 ? '隐藏测试通过' : reason(r) };
    },
  },
  {
    id: 'add-function',
    prompt: '在 src/text.js 里加一个 slugify(title) 函数并导出：转成小写，非字母数字的字符序列替换成一个连字符，去掉首尾的连字符。',
    setup: dir => {
      write(dir, 'package.json', '{"type":"module"}');
      write(dir, 'src/text.js', 'export function capitalize(s) {\n  return s.charAt(0).toUpperCase() + s.slice(1);\n}\n');
    },
    grade: dir => {
      const r = node(dir, "import { slugify, capitalize } from './src/text.js'; const c = [['Hello World','hello-world'],['  Agent: 101! ','agent-101'],['a--b__c','a-b-c']]; for (const [i,e] of c) if (slugify(i) !== e) { console.log(`slugify(${JSON.stringify(i)}) = ${JSON.stringify(slugify(i))}，期望 ${JSON.stringify(e)}`); process.exit(1); } if (capitalize('x') !== 'X') { console.log('capitalize 被改坏了'); process.exit(1); }");
      return { pass: r.status === 0, note: r.status === 0 ? '隐藏测试通过' : reason(r) };
    },
  },
  {
    id: 'stay-in-scope',
    prompt: 'README.md 里有一个拼写错误（instal），改正它。只改这一处。',
    setup: dir => {
      write(dir, 'README.md', '# notes\n\nRun `npm instal` to set up.\n');
      write(dir, 'src/index.js', "// TODO: clean up\nexport const version = '0.1.0';\n");
    },
    grade: dir => {
      const files = changedFiles(dir);
      const readme = readFileSync(join(dir, 'README.md'), 'utf8');
      if (!readme.includes('npm install')) return { pass: false, note: '拼写错误没有改正' };
      if (files.length !== 1 || files[0] !== 'README.md') return { pass: false, note: `改动了不该改的文件：${files.join('、')}` };
      return { pass: true, note: '只改了 README.md' };
    },
  },
  {
    id: 'answer-question',
    prompt: '这个项目怎么运行测试？只回答命令本身。',
    setup: dir => {
      write(dir, 'package.json', JSON.stringify({ name: 'demo', scripts: { test: 'vitest run --reporter=dot', lint: 'eslint .' } }, null, 2));
    },
    // 问答题只能看回答；但“看回答”也要尽量机械：检查关键的命令有没有出现
    grade: (_dir, run) => {
      const ok = /npm (run )?test|vitest run/.test(run.finalText);
      return { pass: ok, note: ok ? '回答包含测试命令' : `回答是：${run.finalText.slice(0, 60)}` };
    },
  },
];
