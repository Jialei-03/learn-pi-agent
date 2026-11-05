// 第 11 章实验：渐进式披露——Skill 的全文什么时候才进入上下文？
//   node labs/ch11/progressive.ts
// 真正的 mox 命令行，Skills 装在 ~/.mox/skills 里，模型是脚本。脚本做的事就是一个听话的模型会做的事：
// 看到系统提示里的目录，判断任务和 release-notes 相符，先读 SKILL.md，再按正文读 references/style.md，最后回答。
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMox } from '../shared/mox-cli.ts';
import { createSkillFixture, installSkills } from './fixture.ts';

const { root } = createSkillFixture();
const home = realpathSync(mkdtempSync(join(tmpdir(), 'ch11-home-')));
const project = realpathSync(mkdtempSync(join(tmpdir(), 'ch11-proj-')));
installSkills(root, home, ['release-notes', 'db-migration']);
const short = (text: string) => text.replaceAll(home, '~');
const catalogOf = (system: string) => system.slice(system.indexOf('Skills 是可选的操作手册'));

try {
  const run = await runMox(['--yolo', '-p', '帮我写 v1.2.0 的发布说明'], {
    cwd: project, home,
    script: (request, n) => {
      if (n === 1) {
        const line = String(request.messages[0].content).split('\n').find(l => l.startsWith('- release-notes：'))!;
        return { toolCalls: [{ name: 'read', arguments: { path: line.match(/（([^（）]+)）$/)![1] } }] };
      }
      if (n === 2) {
        const skillFile = request.messages.flatMap(m => (m.role === 'assistant' && m.tool_calls ? m.tool_calls : [])).map(c => JSON.parse(c.function.arguments).path).at(-1);
        return { toolCalls: [{ name: 'read', arguments: { path: join(dirname(skillFile), 'references/style.md') } }] };
      }
      return { text: '## v1.2.0 — 2026-11-03\n\n### 新功能\n- 新增 mox list 命令……' };
    },
  });
  assert.equal(run.code, 0);

  const catalog = catalogOf(run.requests[0].messages[0].content);
  const [head, ...items] = catalog.split('\n');
  console.log('━━ 第 1 次请求：系统提示里的 Skills 目录 ━━');
  console.log([short(head), ...items.map(short).sort()].join('\n'));

  const results = run.requests.at(-1)!.messages.filter(m => m.role === 'tool').map(m => String(m.content));
  console.log('\n━━ 每次请求带来了什么 ━━');
  console.log('| 请求 | 新进入上下文的内容 | 字符数 |');
  console.log('| --- | --- | --- |');
  console.log(`| 1 | 系统提示里的 Skills 目录（${items.length} 个 Skill 的名字、描述、位置） | ${catalog.length} |`);
  console.log(`| 2 | SKILL.md 正文（read 的结果） | ${results[0].length} |`);
  console.log(`| 3 | references/style.md（read 的结果） | ${results[1].length} |`);
  const mentions = (needle: string) => run.requests.map((r, i) => `第 ${i + 1} 次${JSON.stringify(r.messages).includes(needle) ? '有' : '无'}`).join('，');
  console.log(`\n请求里是否出现 db-migration 的正文：${mentions('只有用户用 /skill:db-migration')}`);
  console.log(`请求里是否出现 style.md 的内容：${mentions('发布说明规范')}`);

  assert.equal(run.requests.length, 3);
  assert.ok(!JSON.stringify(run.requests).includes('只有用户用 /skill:db-migration'));
  assert.ok(!JSON.stringify(run.requests[1].messages).includes('发布说明规范'));
  assert.ok(JSON.stringify(run.requests[2].messages).includes('发布说明规范'));
} finally {
  for (const dir of [home, project, root]) rmSync(dir, { recursive: true, force: true });
}
