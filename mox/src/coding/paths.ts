// 路径解析（第 5 章）。模型写路径的习惯五花八门：相对路径、~、前面带个 @。
// 注意：这里只是“解析”，不是“限制”。工作目录不是沙箱，绝对路径照样能指向任何地方（第 15 章）。
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

export function resolvePath(path: string, cwd: string): string {
  let p = path.trim();
  if (p.startsWith('@')) p = p.slice(1);                 // 模型从对话里抄来的 @src/cli.ts
  if (p === '~' || p.startsWith('~/')) p = homedir() + p.slice(1);
  return isAbsolute(p) ? p : resolve(cwd, p);
}
