// 第 11 章实验共用的 Skills 目录。
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createSkillFixture() {
  const root = mkdtempSync(join(tmpdir(), 'ch11-'));
  const write = (path: string, text: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); };
  write('skills/release-notes/SKILL.md', `---
name: release-notes
description: 根据 git 提交记录写发布说明。用户要求写 changelog、发布说明、版本说明时使用。
---

# 写发布说明

1. 运行 \`git log --oneline <上一个标签>..HEAD\` 收集提交。
2. 按 references/style.md 的规范分组：新功能、修复、破坏性改动。
3. 每条说明写给用户看，不要照抄提交信息。
`);
  write('skills/release-notes/references/style.md', `# 发布说明规范\n\n- 标题用版本号和日期\n- 破坏性改动放在最前面，并写明迁移方法\n- 每条一句话，以动词开头\n${'- 更多细节……\n'.repeat(40)}`);
  // Skill 自带的示例里也有一个 SKILL.md：它不应该被当成独立的 Skill
  write('skills/release-notes/examples/demo/SKILL.md', `---
name: demo
description: 只是 release-notes 的一个示例文件。
---
`);
  write('skills/db-migration/SKILL.md', `---
name: db-migration
description: 生成并检查数据库迁移脚本。
disable-model-invocation: true
---

只有用户用 /skill:db-migration 明确要求时才使用。
`);
  write('skills/broken/SKILL.md', `---
name: broken
---

没有 description 的 Skill。
`);
  write('skills/Bad_Name/SKILL.md', `---
name: Bad_Name
description: 名字不符合规范的 Skill。
---

内容。
`);
  write('team-skills/release-notes/SKILL.md', `---
name: release-notes
description: 团队另一份同名的发布说明 Skill。
---

内容。
`);
  return { root, dirs: [join(root, 'skills'), join(root, 'team-skills')] };
}
