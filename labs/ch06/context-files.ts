// 第 6 章实验：在一个多层的仓库里，哪些说明文件会被读进上下文？顺序如何？
//   node labs/ch06/context-files.ts
// 目录结构（在临时目录里创建）：
//   home/.agent/AGENTS.md          用户全局的偏好
//   repo/AGENTS.md                 仓库约定
//   repo/CLAUDE.md                 同一目录里的另一个文件名：AGENTS.md 已经有了，它不会被读到
//   repo/packages/web/CLAUDE.md    子项目约定（这个目录只有 CLAUDE.md）
//   repo/packages/web/src/         当前工作目录
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { loadProjectContextFiles } from '@earendil-works/pi-coding-agent';

const root = mkdtempSync(join(tmpdir(), 'ch06-'));
const write = (path: string, text: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); };
write('home/.agent/AGENTS.md', '回答用中文。');
write('repo/AGENTS.md', '用 pnpm，不要用 npm。提交前运行 pnpm test。');
write('repo/CLAUDE.md', '（给 Claude Code 的说明，同一目录里已经有 AGENTS.md，同一个目录只取第一个）');
write('repo/packages/web/CLAUDE.md', '这个包是 React 前端，组件放在 src/components。');
mkdirSync(join(root, 'repo/packages/web/src'), { recursive: true });
const cwd = join(root, 'repo/packages/web/src');

const piFiles = loadProjectContextFiles({ cwd, agentDir: join(root, 'home/.agent') });

const show = (files: { path: string; content: string }[]) => files.map((f, i) => `  ${i + 1}. ${relative(root, f.path).padEnd(30)} ${f.content}`).join('\n');
console.log(`当前目录：${relative(root, cwd)}\n`);
console.log('Pi（loadProjectContextFiles）：');
console.log(show(piFiles));

const names = (files: { path: string }[]) => files.map(f => relative(root, f.path));
assert.deepEqual(names(piFiles), ['home/.agent/AGENTS.md', 'repo/AGENTS.md', 'repo/packages/web/CLAUDE.md']);   // 全局 → 仓库根 → 子项目；repo/CLAUDE.md 没有出现
