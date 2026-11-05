// 第 9 章实验：扩展从哪里加载、按什么顺序加载？项目里的扩展什么时候才会运行？
//   node labs/ch09/load.ts
// 三个位置各放一个扩展：~/.mox/extensions（用户目录）、<项目>/.mox/extensions（项目里，可能是别人写的）、-e 指定的文件。
// 每个扩展在被加载时、在 tool_call 上各留一行记录。用真正的 mox 命令行分别不加和加 --trust 各跑一次。
// 项目里的扩展还会往一个"外面的"文件里写一句话，证明它在你的机器上真的执行了代码。
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMox } from '../shared/mox-cli.ts';

const root = mkdtempSync(join(tmpdir(), 'ch09-load-'));
const home = join(root, 'home');
const cwd = join(root, 'project');
const log = join(root, 'trace.log');
const planted = join(root, 'planted-by-project.txt');          // 项目里的扩展想偷偷写的文件
for (const dir of [join(home, '.mox/extensions'), join(cwd, '.mox/extensions')]) mkdirSync(dir, { recursive: true });

const extension = (label: string, extra = '') => `
import { appendFileSync } from 'node:fs';
export default mox => {
  appendFileSync(${JSON.stringify(log)}, '加载 ${label}\\n');
  mox.on('tool_call', name => { appendFileSync(${JSON.stringify(log)}, '  tool_call → ${label}\\n'); });
  ${extra}
};
`;
writeFileSync(join(home, '.mox/extensions/10-user.ts'), extension('用户目录'));
writeFileSync(join(cwd, '.mox/extensions/project.ts'), extension('项目目录', `appendFileSync(${JSON.stringify(planted)}, '项目里的扩展在你的机器上运行了\\n');`));
writeFileSync(join(root, 'flag.ts'), extension('命令行-e指定'));
writeFileSync(join(cwd, 'README.md'), '# demo\n');

async function run(args: string[]) {
  writeFileSync(log, '');
  const { code, output } = await runMox(['-p', '读一下 README', '--yolo', ...args], {
    cwd, home, script: (_request, n) => (n === 1 ? { toolCalls: [{ name: 'read', arguments: { path: 'README.md' } }] } : { text: '好了。' }),
  });
  assert.equal(code, 0, output);
  return readFileSync(log, 'utf8').trim().split('\n');
}

const plain = await run(['-e', join(root, 'flag.ts')]);
const plantedWithout = existsSync(planted);
const trusted = await run(['--trust', '-e', join(root, 'flag.ts')]);

console.log('| 命令 | 加载顺序 | tool_call 的调用顺序 | 项目扩展执行了代码吗 |');
console.log('| --- | --- | --- | --- |');
const order = (lines: string[], prefix: string) => lines.filter(l => l.trim().startsWith(prefix)).map(l => l.split(/[ →]+/).at(-1)).join(' → ');
console.log(`| \`mox -e flag.ts\` | ${order(plain, '加载')} | ${order(plain, 'tool_call')} | ${plantedWithout ? '**是**' : '否'} |`);
console.log(`| \`mox --trust -e flag.ts\` | ${order(trusted, '加载')} | ${order(trusted, 'tool_call')} | ${existsSync(planted) ? '**是**：' + readFileSync(planted, 'utf8').trim() : '否'} |`);

assert.deepEqual(plain.filter(l => l.startsWith('加载')), ['加载 用户目录', '加载 命令行-e指定']);
assert.deepEqual(trusted.filter(l => l.startsWith('加载')), ['加载 用户目录', '加载 项目目录', '加载 命令行-e指定']);
assert.equal(plantedWithout, false);
assert.ok(existsSync(planted));
