// 实战检验用：默认加载课程自带的参考实现 mox/（Mox-agent 子模块）；
// 设置 MOX_DIR=你自己的 mox 目录，就改为检验你一步步写出来的那份。
//   node labs/ch05/practice.ts
//   MOX_DIR=~/my-mox node labs/ch05/practice.ts
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const custom = process.env.MOX_DIR?.trim();                     // 空字符串也当作没设置
export const MOX_DIR = custom ? resolve(custom.replace(/^~(?=\/)/, process.env.HOME ?? '~')) : join(ROOT, 'mox');
export const usingReference = !custom;

/** 加载 mox 的一个模块，比如 await loadMox('loop.ts')。 */
export async function loadMox<T = any>(file: string): Promise<T> {
  const path = join(MOX_DIR, 'src', file);
  if (!existsSync(path)) throw new Error(`${path} 不存在：这一章的实战还没写到这个文件，或者 MOX_DIR 指错了`);
  return import(pathToFileURL(path).href);
}

/** 在检验结果前面说明检验的是哪一份。 */
export const whose = () => (usingReference ? '检验对象：参考实现 mox/（设置 MOX_DIR 改为检验你自己的）' : `检验对象：${MOX_DIR}`);
