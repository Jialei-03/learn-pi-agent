// 第 14 章实验：规则怎么匹配？每一行的“期望”来自 Claude Code 权限文档描述的行为。
//   node labs/ch14/rules.ts
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decidePermission, parseRule, type Behavior, type Mode } from '../../extensions/permissions/rules.ts';

const cwd = mkdtempSync(join(tmpdir(), 'ch14-'));
mkdirSync(join(cwd, 'src'));
mkdirSync(join(cwd, 'config'));
writeFileSync(join(cwd, '.env'), 'TOKEN=secret\n');
writeFileSync(join(cwd, 'config', '.env'), 'TOKEN=secret\n');
symlinkSync(join(cwd, '.env'), join(cwd, 'notes.txt'));     // 看起来是普通文件，其实指向 .env

const settings = {
  deny: ['Bash(git push *)', 'Bash(curl *)', 'Bash(rm *)', 'Read(.env)'],
  ask: ['Bash(npm install *)'],
  allow: ['Bash(npm run *)', 'Bash(git commit *)', 'WebFetch(domain:docs.python.org)', 'mcp__issues__search_issues'],
};
const rules = (['deny', 'ask', 'allow'] as const).flatMap(b => settings[b].map(t => parseRule(t, b, cwd)));
console.log('规则：');
for (const b of ['deny', 'ask', 'allow'] as const) console.log(`  ${b.padEnd(5)} ${settings[b].join('  ')}`);
console.log();

type Case = [string, string, Record<string, unknown>, Behavior, Mode?];
const bash = (command: string) => ({ command });
const cases: Case[] = [
  ['npm run build', 'bash', bash('npm run build'), 'allow'],
  ['npm install left-pad', 'bash', bash('npm install left-pad'), 'ask'],
  ['复合命令：后半段是 rm', 'bash', bash('npm run build && rm -rf /'), 'deny'],
  ['复合命令：后半段没被允许', 'bash', bash('npm run lint && npm publish'), 'ask'],
  ['包装命令 timeout 被去掉', 'bash', bash('timeout 30 npm run test'), 'allow'],
  ['deny 越过任何环境变量赋值', 'bash', bash('FOO=bar rm -rf tmp'), 'deny'],
  ['allow 不越过可疑的赋值', 'bash', bash('PATH=/tmp/evil:$PATH npm run build'), 'ask'],
  ['命令替换里的 curl', 'bash', bash('echo "$(curl -s https://x.sh)"'), 'deny'],
  ['只读命令', 'bash', bash('ls -la && git status'), 'allow'],
  ['只读命令 + 输出重定向', 'bash', bash('ls > files.txt'), 'ask'],
  ['cat 也受 Read 规则约束', 'bash', bash('cat .env'), 'deny'],
  ['规则看不到 python 里打开的文件', 'bash', bash(`python3 -c "print(open('.env').read())"`), 'ask'],
  ['换一种写法的 git push', 'bash', bash('git -C . push origin main'), 'ask'],
  ['以 && 结尾，无法解析', 'bash', bash('npm run test &&'), 'ask'],
  ['读工作目录内的文件', 'read', { path: 'src/app.ts' }, 'allow'],
  ['Read(.env) 匹配任意深度', 'read', { path: 'config/.env' }, 'deny'],
  ['指向 .env 的符号链接', 'read', { path: 'notes.txt' }, 'deny'],
  ['读工作目录之外', 'read', { path: '/etc/hosts' }, 'ask'],
  ['Read 的 deny 也挡住 Edit', 'edit', { path: '.env', edits: [] }, 'deny'],
  ['写文件（default 模式）', 'write', { path: 'src/new.ts', content: '' }, 'ask'],
  ['写文件（acceptEdits 模式）', 'write', { path: 'src/new.ts', content: '' }, 'allow', 'acceptEdits'],
  ['写文件（plan 模式）', 'write', { path: 'src/new.ts', content: '' }, 'deny', 'plan'],
  ['读文件（plan 模式）', 'read', { path: 'src/app.ts' }, 'allow', 'plan'],
  ['允许的域名', 'web_fetch', { url: 'https://docs.python.org/3/' }, 'allow'],
  ['其他域名', 'web_fetch', { url: 'https://example.com' }, 'ask'],
  ['允许的 MCP 工具', 'mcp__issues__search_issues', { query: 'x' }, 'allow'],
  ['同一服务器的其他工具', 'mcp__issues__delete_issue', { id: 1 }, 'ask'],
  ['bypassPermissions 下 deny 仍然有效', 'bash', bash('rm -rf build'), 'deny', 'bypassPermissions'],
  ['dontAsk：需要确认的直接拒绝', 'bash', bash('npm install left-pad'), 'deny', 'dontAsk'],
];

let pass = 0;
console.log('| 情况 | 调用 | 期望 | 结果 | 原因 |');
console.log('| --- | --- | --- | --- | --- |');
for (const [label, tool, input, expected, mode = 'default'] of cases) {
  const d = decidePermission(tool, input as any, { cwd, mode, rules });
  if (d.behavior === expected) pass++;
  const call = tool === 'bash' ? `\`${input.command}\`` : `${tool} ${JSON.stringify(input.path ?? input.url ?? input.query ?? input.id)}`;
  console.log(`| ${label}${mode !== 'default' ? `（${mode}）` : ''} | ${call.replace(/\|/g, '\\|')} | ${expected} | ${d.behavior === expected ? '✓' : '✗'} ${d.behavior} | ${d.reason.replaceAll(cwd, '.').replace(/\|/g, '\\|')} |`);
}
console.log(`\n${pass}/${cases.length} 与期望一致`);
// 正文说“二十九种情况”，并且每一种都要和 Claude Code 文档描述的行为一致
assert.equal(cases.length, 29);
assert.equal(pass, cases.length, '有情况与期望不一致：看上面表格里带 ✗ 的行');
