// 第 21 章实验：mox 的地图，从源码里量出来：每个文件多少行、导出什么、依赖谁。
//   node labs/ch21/map.ts
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOX_DIR, whose } from '../shared/mox-dir.ts';

console.log(`${whose()}\n`);
const dir = `${join(MOX_DIR, 'src')}/`;
// 每个文件在课程里的位置（章节号）
const chapters: Record<string, string> = {
  'model.ts': '2', 'loop.ts': '3', 'tools.ts': '4、5', 'session.ts': '7', 'compact.ts': '8',
  'context.ts': '6、11', 'mcp.ts': '12', 'extensions.ts': '9、13–16、18', 'cli.ts': '5、14、17、18、19',
};
const files = readdirSync(dir).filter(f => f.endsWith('.ts')).sort();
const rows = files.map(file => {
  const text = readFileSync(dir + file, 'utf8');
  const exported = [...text.matchAll(/^export (?:async )?(?:function|const|type) (\w+)/gm)].map(m => m[1]);
  const imports = [...text.matchAll(/^import .* from '\.\/(\w+)\.ts'/gm)].map(m => `${m[1]}.ts`);
  return { file, lines: text.trimEnd().split('\n').length, exported, imports: [...new Set(imports)], chapters: chapters[file] };
});

console.log('| 文件 | 行数 | 对应章节 | 导出 | 依赖 |\n| --- | --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.file} | ${r.lines} | ${r.chapters} | ${r.exported.length ? r.exported.map(e => `\`${e}\``).join(' ') : '（脚本，没有导出）'} | ${r.imports.join('、') || '—'} |`);
const total = rows.reduce((n, r) => n + r.lines, 0);
console.log(`\n合计 ${rows.length} 个文件、${total} 行。`);

// 分层：除了 cli.ts，每个文件最多依赖 model.ts 和 loop.ts（它们定义了消息和工具的类型）。组装的事全部在 cli.ts 里
const lower = rows.filter(r => r.file !== 'cli.ts');
console.log(`\ncli.ts 依赖 ${rows.find(r => r.file === 'cli.ts')!.imports.length} 个文件；其余 ${lower.length} 个文件各自只依赖：${[...new Set(lower.flatMap(r => r.imports))].join('、')}`);

assert.equal(rows.length, Object.keys(chapters).length, '每个文件都登记了章节');
assert.deepEqual([...new Set(lower.flatMap(r => r.imports))].sort(), ['loop.ts', 'model.ts']);
assert.equal(rows.find(r => r.file === 'cli.ts')!.imports.length, rows.length - 1, 'cli.ts 把其余每个文件都装起来');
assert.ok(lower.every(r => !r.imports.includes('cli.ts')));
assert.ok(total < 800, 'mox 要保持小');
