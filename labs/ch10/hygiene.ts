// 第 10 章实验：过期、冲突、泄密——哪些能被机械地发现，哪些必须交给人？
//   node labs/ch10/hygiene.ts
// 三个小检查，都是几行代码能写出来的东西：
//   1. 过期：记忆里提到的文件还在吗？多久没更新了？
//   2. 冲突：哪些记忆在说同一件事？
//   3. 泄密：store.ts 的密钥规则能拦住什么，拦不住什么？
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, looksLikeSecret, type MemoryType } from '../../extensions/memory/store.ts';
import { jaccard } from './similarity.ts';

const root = mkdtempSync(join(tmpdir(), 'ch10-'));
const project = join(root, 'project');
mkdirSync(join(project, 'src', 'auth'), { recursive: true });
mkdirSync(join(project, '.github', 'workflows'), { recursive: true });
writeFileSync(join(project, 'src', 'auth', 'session.ts'), '');
writeFileSync(join(project, '.github', 'workflows', 'ci.yml'), '');

const store = new MemoryStore(join(root, 'memory'));
const TODAY = '2026-11-04';                       // 实验里的“今天”固定下来，输出才不会随日期变化
const memories: [name: string, type: MemoryType, updated: string, description: string, content: string][] = [
  ['auth-entry', 'project', '2026-05-02', '认证逻辑的入口', '认证逻辑在 `src/auth.ts`，登录态存在 cookie 里。'],
  ['ci-config', 'reference', '2026-10-20', 'CI 配置的位置', 'CI 配置在 `.github/workflows/ci.yml`。'],
  ['code-freeze', 'project', '2026-03-10', '版本冻结的日期', '5 月 1 日冻结代码，之后只合并修复。'],
  ['package-manager', 'feedback', '2026-09-01', '这个项目用 pnpm，不用 npm', '运行脚本和安装依赖都用 pnpm。'],
  ['use-yarn', 'feedback', '2026-10-30', '这个项目改用 yarn，不再用 pnpm', '团队决定迁移到 yarn。'],
  ['test-runner', 'reference', '2026-10-02', '测试用 vitest 运行', '运行 vitest，不要用 jest。'],
];
for (const [name, type, updated, description, content] of memories) {
  store.save({ name, description, type, content, status: 'active', source: '用户在对话中要求记住' });
  const file = join(store.dir, `${name}.md`);
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^updated: .*/m, `updated: ${updated}`));   // 回填写入日期
}
const all = store.list();
const daysSince = (date: string) => Math.round((Date.parse(TODAY) - Date.parse(date)) / 86_400_000);

// ── 1. 过期 ───────────────────────────────────────────
console.log('一、过期：记忆里提到的路径还在吗？');
console.log('| 记忆 | 写入至今 | 提到的路径 | 路径还在吗 | 判断 |');
console.log('| --- | --- | --- | --- | --- |');
const verdicts = new Map<string, string>();
for (const m of all) {
  const paths = [...m.content.matchAll(/`([^`\s]+\.[a-z]+)`/g)].map(x => x[1]);
  const missing = paths.filter(p => !existsSync(join(project, p)));
  const age = daysSince(m.updated);
  const verdict = missing.length ? '⚠ 过期：文件不存在' : age > 180 ? '？ 太久没更新，要问人' : '✓ 看不出问题';
  verdicts.set(m.name, verdict);
  console.log(`| ${m.name} | ${age} 天 | ${paths.map(p => `\`${p}\``).join('、') || '—'} | ${paths.length ? (missing.length ? '✗ 否' : '✓ 是') : '—'} | ${verdict} |`);
}

// ── 2. 冲突 ───────────────────────────────────────────
console.log('\n二、冲突：哪些记忆在说同一件事？（比较一行摘要）');
console.log('| 记忆 A | 记忆 B | 相似度 | 判断 |');
console.log('| --- | --- | --- | --- |');
const pairs: { a: string; b: string; score: number }[] = [];
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) pairs.push({ a: all[i].name, b: all[j].name, score: jaccard(all[i].description, all[j].description) });
for (const p of pairs.sort((x, y) => y.score - x.score).slice(0, 3)) console.log(`| ${p.a} | ${p.b} | ${p.score.toFixed(2)} | ${p.score > 0.3 ? '⚠ 同一个话题，需要人来裁决' : '无关'} |`);
const index = readFileSync(join(store.dir, 'MEMORY.md'), 'utf8').split('\n').filter(l => /package-manager|use-yarn/.test(l));
console.log(`\n模型在索引里同时看到：\n${index.map(l => `  │ ${l}`).join('\n')}`);

// ── 3. 泄密 ───────────────────────────────────────────
console.log('\n三、泄密：store.ts 的密钥规则');
console.log('| 想保存的文字 | 被拒绝了吗 |');
console.log('| --- | --- |');
const probes = [
  'OPENAI_API_KEY=sk-live-0123456789abcdefghij',
  'AWS key：AKIAABCDEFGHIJKLMNOP',
  'password: correct-horse-battery',
  '-----BEGIN RSA PRIVATE KEY-----',
  '数据库密码是 hunter2hunter2',
  'Slack bot 的 token：xoxb-1234567890-abcdefghij',          // 全角冒号，而且不在规则列表里
  '联系人：张三，手机 13800138000，邮箱 zhang@example.com',
];
for (const text of probes) console.log(`| ${text} | ${looksLikeSecret(text) ? '✓ 拒绝' : '✗ 放行'} |`);

// 关键结论
assert.match(verdicts.get('auth-entry')!, /过期/);
assert.match(verdicts.get('code-freeze')!, /太久/);
assert.match(verdicts.get('ci-config')!, /看不出/);
assert.ok(pairs.find(p => [p.a, p.b].sort().join() === 'package-manager,use-yarn')!.score > 0.3, '同一话题的两条记忆应该被找出来');
assert.deepEqual(probes.map(looksLikeSecret), [true, true, true, true, false, false, false]);
