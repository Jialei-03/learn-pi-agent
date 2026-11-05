// 第 18 章实验共用：找扩展文件。参考实现在课程仓库的 extensions/<名字>/mox.ts；
// 检验自己的 mox（设置了 MOX_DIR）时，找 $MOX_DIR/extensions/<名字>.ts，没有的话退回参考实现并说明。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOX_DIR, usingReference } from '../shared/mox-dir.ts';

const warned = new Set<string>();
export function extFile(name: string): string {
  const reference = fileURLToPath(new URL(`../../extensions/${name}/mox.ts`, import.meta.url));
  if (usingReference) return reference;
  const mine = join(MOX_DIR, 'extensions', `${name}.ts`);
  if (existsSync(mine)) return mine;
  if (!warned.has(mine)) { warned.add(mine); console.log(`（没有找到 ${mine}，用参考实现 ${name}）`); }
  return reference;
}
