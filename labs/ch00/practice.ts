// 第 0 章实战的检验：准备好你的 mox 目录。
//   node labs/ch00/practice.ts                      检查参考实现 mox/ 能不能用
//   MOX_DIR=~/my-mox node labs/ch00/practice.ts     检查你自己的目录建好了没有
// 之后每一章的 practice.ts 都用同样的方式切换检验对象。
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MOX_DIR, usingReference, whose } from '../shared/mox-dir.ts';

console.log(`${whose()}\n`);
const checks: [string, boolean, string][] = [];

const [major, minor] = process.versions.node.split('.').map(Number);
checks.push(['Node.js ≥ 22.19（直接运行 TypeScript）', major > 22 || (major === 22 && minor >= 19), `当前 v${process.versions.node}`]);

const src = join(MOX_DIR, 'src');
checks.push([`目录存在：${usingReference ? 'mox/（参考实现）' : MOX_DIR}`, existsSync(src), existsSync(src) ? `src/ 里现在有 ${readdirSync(src).filter(f => f.endsWith('.ts')).length} 个 .ts 文件` : usingReference ? '没找到 mox/src，先运行 git submodule update --init' : `没找到 ${src}：先 mkdir -p ${MOX_DIR}/src`]);

if (usingReference) {
  const help = spawnSync(process.execPath, [join(MOX_DIR, 'src/cli.ts'), '--help'], { encoding: 'utf8' });
  checks.push(['参考实现的命令行能启动', help.status === 0 && help.stdout.includes('用法'), '`node mox/src/cli.ts --help` 打印了用法']);
}

for (const [label, ok, detail] of checks) console.log(`${ok ? '✓' : '✗'} ${label}：${detail}`);
const failed = checks.filter(([, ok]) => !ok).length;
console.log(failed ? `\n有 ${failed} 项没通过。` : '\n准备好了，下一章开始写第一个 Agent。');
process.exitCode = failed ? 1 : 0;
