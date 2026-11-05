// 第 6 章实战检验：mox 的系统提示和 AGENTS.md 收集写对了吗？
//   node labs/ch06/practice.ts                 检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch06/practice.ts  检验你自己写的
// 在临时目录里搭一个多层仓库，调用你的 systemPrompt / loadSkills，检查收集顺序、取舍规则和 Skills 目录；
// 再用你的 runLoop 跑两个回合，检查“系统提示在最前面、历史只追加”。最后打印 mox 为这个仓库拼出的系统提示。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMox, whose } from '../shared/mox-dir.ts';
import { scripted } from '../shared/scripted.ts';

const { systemPrompt, loadSkills } = await loadMox('context.ts');
const { runLoop } = await loadMox('loop.ts');
console.log(`${whose()}\n`);

const root = mkdtempSync(join(tmpdir(), 'ch06-practice-'));
const write = (path: string, text: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); };
write('home/.mox/AGENTS.md', '回答用中文。\n');
write('repo/AGENTS.md', '用 pnpm，不要用 npm。');
write('repo/CLAUDE.md', '（同一目录里 AGENTS.md 优先，这份不该出现）');
write('repo/packages/web/CLAUDE.md', '这个包是 React 前端。');
write('home/.mox/skills/release/SKILL.md', '---\nname: release\ndescription: 发布新版本时使用\n---\n\n（步骤）');
mkdirSync(join(root, 'repo/packages/web/src'), { recursive: true });
const cwd = join(root, 'repo/packages/web/src'), home = join(root, 'home');

const skills = loadSkills([join(home, '.mox/skills')]);
const prompt: string = systemPrompt(cwd, home, skills);
const rows: [string, string][] = [];
const check = (name: string, seen: string, ok: boolean) => { rows.push([name, `${ok ? '✓' : '✗'} ${seen}`]); assert.ok(ok, `${name}：${seen}`); };

const files = [...prompt.matchAll(/<file path="([^"]+)">\n([\s\S]*?)\n<\/file>/g)].map(m => m[1].replace(root, ''));
check('说明文件按“全局 → 仓库根 → 子项目”排列，每份包在 <file path> 里', files.join(' → '), files.join() === '/home/.mox/AGENTS.md,/repo/AGENTS.md,/repo/packages/web/CLAUDE.md');
check('同一目录 AGENTS.md 优先，CLAUDE.md 不出现', 'repo/CLAUDE.md 没有进入提示', !prompt.includes('不该出现'));
check('文件内容去掉首尾空白', JSON.stringify(prompt.match(/回答用中文。.*/)?.[0]), /<file path="[^"]+">\n回答用中文。\n<\/file>/.test(prompt));
check('提示里有工作目录', cwd.replace(root, '…'), prompt.includes(cwd));
check('Skills 只列名字、描述和路径，不放全文', skills.map((s: any) => s.name).join(','), prompt.includes('release') && prompt.includes('发布新版本时使用') && prompt.includes('SKILL.md') && !prompt.includes('（步骤）'));

const bare = join(root, 'bare/project'); mkdirSync(bare, { recursive: true });
const plain: string = systemPrompt(bare, join(root, 'nohome'), []);
check('没有说明文件、没有 Skills 时，这两段都不出现', `${plain.split('\n').length} 行`, !plain.includes('<file') && !plain.includes('Skills'));

// 只追加：两个回合，第二次请求的消息必须以第一次请求的全部消息开头
const model = scripted([{ text: '第一个回答' }, { text: '第二个回答' }]);
const messages: any[] = [];
for (const text of ['第一个问题', '第二个问题']) { messages.push({ role: 'user', content: text }); await runLoop(messages, { model, system: prompt, tools: [] }); }
const [first, second] = model.requests.map((r: any) => r.messages);
check('系统提示在最前面，第二次请求以第一次请求的全部消息开头（缓存前缀不变）', `${first.length} 条 → ${second.length} 条消息`, second[0].role === 'system' && JSON.stringify(second.slice(0, first.length)) === JSON.stringify(first));

console.log('| 检查项 | 结果 |');
console.log('| --- | --- |');
for (const [name, seen] of rows) console.log(`| ${name} | ${seen.replace(/\|/g, '/')} |`);

console.log('\n── mox 为这个仓库拼出的系统提示 ──');
console.log(prompt.replaceAll(root, '').replace(/今天：\d{4}-\d\d-\d\d/, '今天：<日期>'));
