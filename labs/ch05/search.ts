// 第 5 章实验：grep、find、ls 看得到什么、看不到什么。
//   node labs/ch05/search.ts
// 临时目录里放一个小项目：源码、构建产物（写进了 .gitignore）、node_modules 和 .git。
// mox 的三个工具用 Node 自带的 fs.globSync 和正则，只硬编码跳过 .git 和 node_modules；
// Pi 的对应工具调用 rg 和 fd，所以遵守 .gitignore（这台机器不一定装了它们，这里只跑 mox，Pi 的做法看源码）。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codingTools } from '../../mox/src/tools.ts';

const dir = mkdtempSync(join(tmpdir(), 'ch05-search-'));
const write = (path: string, text: string) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text); };
write('src/app.ts', 'export const a = 1; // TODO: 换成配置项\nexport const b = 2;\n');
write('src/util.ts', 'export const todo = "todo list";\n');
write('build/app.js', 'var a = 1; // TODO: 换成配置项\n');
write('node_modules/lib/index.js', '// TODO: lib 自己的待办\n');
write('.git/config', '[core] # TODO\n');
write('.gitignore', 'build/\n');

const tools = Object.fromEntries(codingTools(dir).map(t => [t.name, t]));
const run = async (name: string, args: object) => String(await tools[name].run(args));
const show = (title: string, out: string) => console.log(`── ${title}\n${out.split('\n').map(l => `   ${l}`).join('\n')}\n`);

const ls = await run('ls', {});
const found = await run('find', { pattern: '*.js' });
const hits = await run('grep', { pattern: 'TODO' });
const insensitive = await run('grep', { pattern: 'todo', ignoreCase: true, glob: '*.ts' });
const limited = await run('grep', { pattern: 'export', limit: 1 });
const missing = await run('grep', { pattern: '不存在的词' });

show('ls（目录名后面带 /，包括以点开头的）', ls);
show("find { pattern: '*.js' }", found);
show("grep { pattern: 'TODO' }", hits);
show("grep { pattern: 'todo', ignoreCase: true, glob: '*.ts' }", insensitive);
show("grep { pattern: 'export', limit: 1 }", limited);
show("grep { pattern: '不存在的词' }", missing);

assert.ok(ls.includes('.git/') && ls.includes('node_modules/'));          // ls 什么都列
assert.equal(found, 'build/app.js');                                         // node_modules 里的 index.js 被跳过，但 build/ 里的没有（.gitignore 不起作用）
assert.deepEqual(hits.split('\n'), ['build/app.js:1: var a = 1; // TODO: 换成配置项', 'src/app.ts:1: export const a = 1; // TODO: 换成配置项']);
assert.ok(limited.includes('已达到 1 处的上限'));
assert.equal(missing, '没有匹配');
