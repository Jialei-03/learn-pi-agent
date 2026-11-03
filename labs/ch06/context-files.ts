// 第 6 章实验：在一个多层的仓库里，哪些说明文件会被读进上下文？顺序如何？
//   node labs/ch06/context-files.ts
// 目录结构（在临时目录里创建）：
//   home/.agent/AGENTS.md          用户全局的偏好
//   repo/AGENTS.md                 仓库约定
//   repo/packages/web/CLAUDE.md    子项目约定（另一个文件名）
//   repo/packages/web/src/         当前工作目录
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { loadProjectContextFiles } from '@earendil-works/pi-coding-agent';
import { discoverContextFiles } from '../../mox/src/context.ts';

const root = mkdtempSync(join(tmpdir(), 'ch06-'));
const write = (path: string, text: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); };
write('home/.agent/AGENTS.md', '回答用中文。');
write('repo/AGENTS.md', '用 pnpm，不要用 npm。提交前运行 pnpm test。');
write('repo/packages/web/CLAUDE.md', '这个包是 React 前端，组件放在 src/components。');
mkdirSync(join(root, 'repo/packages/web/src'), { recursive: true });
const cwd = join(root, 'repo/packages/web/src');

const show = (files: { path: string; content: string }[]) => files.map((f, i) => `  ${i + 1}. ${relative(root, f.path).padEnd(30)} ${f.content}`).join('\n');
console.log(`当前目录：${relative(root, cwd)}\n`);
console.log('mox：');
console.log(show(discoverContextFiles(cwd, join(root, 'home/.agent'))));
console.log('\nPi：');
console.log(show(loadProjectContextFiles({ cwd, agentDir: join(root, 'home/.agent') })));
