// 第 10 章实验：记忆有一百多条时，模型在系统提示里看得到哪些？
//   node labs/ch10/scale.ts
// promptSection 只放索引的前 100 行（按名字排序）。这里造 120 条无关紧要的站会纪要，外加三条真正有用的记忆，
// 看哪些被挤出了上下文；再用一个最简单的关键词检索做对照，看它在哪里有用、在哪里会漏。
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, type Memory } from '../../extensions/memory/store.ts';
import { overlap } from './similarity.ts';

const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'ch10-')), 'memory'));
const add = (name: string, description: string, content: string) => store.save({ name, description, type: 'project', content, status: 'active', source: '用户在对话中要求记住' });

for (let i = 1; i <= 120; i++) add(`standup-${String(i).padStart(3, '0')}`, `第 ${i} 次站会的结论`, `第 ${i} 次站会：没有需要长期记住的决定。`);
add('deploy-checklist', '上线前的检查清单', '上线前依次确认：数据库迁移已执行、灰度开关已打开、值班同学已通知。');
add('package-manager', '这个项目用 pnpm，不用 npm', '运行脚本和安装依赖都用 pnpm。');
add('test-command', '怎么运行测试', '用 pnpm test 运行全部测试；只跑单个文件时加 --filter。');

// ── 1. 放进系统提示的是哪些 ───────────────────────────
const section = store.promptSection();
const shown = new Set(section.split('\n').filter(l => l.startsWith('- ')).map(l => l.match(/\[(.+?)\]/)![1]));
const all = store.list();
const lines = section.replaceAll(store.dir, '<记忆目录>').split('\n');
console.log(`记忆共 ${all.length} 条；memory 小节 ${lines.join('\n').length} 个字符，只列出了前 ${shown.size} 条。小节的这一段：`);
console.log(lines.filter(l => l.startsWith('- ')).slice(-1).concat(lines.filter(l => l.startsWith('（还有'))).map(l => `  │ ${l}`).join('\n'));
console.log('━━ 用户说了一句话，哪些记忆能帮上忙？ ━━');

// ── 2. 关键词检索：按相邻字符的重合度打分，取前 3 条 ───────────
const recall = (query: string, k = 3) => all
  .map(m => ({ name: m.name, score: overlap(query, `${m.name} ${m.description} ${m.content}`) }))
  .filter(r => r.score > 0)
  .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  .slice(0, k)
  .map(r => r.name);

const tasks: { query: string; needs: string }[] = [
  { query: '跑一下测试', needs: 'test-command' },
  { query: '安装依赖', needs: 'package-manager' },
  { query: '怎么发布到线上', needs: 'deploy-checklist' },
];
console.log('| 用户说 | 需要的记忆 | 在前 100 行索引里吗 | 关键词检索（前 3 条） |');
console.log('| --- | --- | --- | --- |');
for (const { query, needs } of tasks) {
  const hits = recall(query);
  console.log(`| ${query} | ${needs} | ${shown.has(needs) ? '✓ 在' : '✗ 被挤出去了'} | ${hits.includes(needs) ? '✓ ' : '✗ '}${hits.join('、') || '（没有匹配）'} |`);
}

assert.equal(all.length, 123);
assert.equal(shown.size, 100);
assert.ok(!shown.has('test-command'), 'test-command 排在字母表靠后，被挤出了前 100 行');
assert.ok(shown.has('deploy-checklist') && shown.has('package-manager'));
assert.ok(recall('跑一下测试').includes('test-command'), '检索能找回被挤出去的记忆');
assert.ok(!recall('怎么发布到线上').includes('deploy-checklist'), '词不一样（发布 / 上线），关键词检索找不到');
