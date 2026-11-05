// 第 10 章实验：真正的 mox 命令行加载记忆扩展，跨进程、跨会话。
//   node labs/ch10/mox-cli.ts
// 第一次 `mox -p -e extensions/memory/mox.ts`：模型调用 save_memory。-p 没有终端，ask 返回 undefined，记忆只进待确认。
// 我们（扮演用户）用 MemoryStore 批准它，这等价于在交互模式里输入 /memory approve。
// 第二次 `mox -p`：全新的进程、全新的会话，系统提示里应该已经有这条记忆。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, projectSlug } from '../../extensions/memory/store.ts';
import { runMox } from '../shared/mox-cli.ts';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'ch10-cli-')));
const home = join(root, 'home');
const cwd = join(root, 'project');
mkdirSync(home); mkdirSync(cwd);
const store = new MemoryStore(join(home, '.mox', 'memory', projectSlug(cwd)));   // 记忆目录取决于 HOME 和启动时的工作目录

async function mox(prompt: string, script: Parameters<typeof runMox>[1]['script']) {
  const { code, output, requests } = await runMox(['-p', prompt, '--yolo', '-e', join(import.meta.dirname, '../../extensions/memory/mox.ts')], { cwd, home, script });
  assert.equal(code, 0, output);
  return { out: output, requests, tools: requests[0].tools!.map(t => t.function.name) };
}

const first = await mox('记住：这个项目用 pnpm', (_request, n) => n === 1
  ? { toolCalls: [{ name: 'save_memory', arguments: { name: 'package-manager', description: '这个项目用 pnpm，不用 npm', type: 'feedback', content: '用 pnpm。原因：锁文件是 pnpm-lock.yaml。' } }] }
  : { text: '记下了。' });
console.log('━━ 第一次运行（mox -p，没有终端）━━');
console.log(`发给模型的工具：${first.tools.join('、')}`);
console.log(first.out.trim().split('\n').slice(0, 3).join('\n'));
console.log(`磁盘上：${store.list().map(m => `${m.name}（${m.status}）`).join('、')}`);
assert.deepEqual(first.tools.slice(-3), ['save_memory', 'forget_memory', 'task']);
assert.equal(store.get('package-manager')?.status, 'pending');

store.setStatus('package-manager', 'active');                    // 等价于 /memory approve package-manager
console.log('用户批准：/memory approve package-manager\n');

const second = await mox('跑一下测试', ({ messages }) => ({ text: String(messages[0].content).includes('package-manager') ? '我会运行 pnpm test。' : '我会运行 npm test。' }));
const system = String(second.requests[0].messages[0].content);
console.log('━━ 第二次运行（全新的进程）━━');
console.log(`系统提示最后几行：\n${system.slice(system.indexOf('<memory>')).replaceAll(store.dir, '<记忆目录>').split('\n').slice(0, 4).map(l => '  │ ' + l).join('\n')}`);
console.log(`模型的回答：${second.out.trim().split('\n').at(-1)}`);
assert.match(second.out, /pnpm test/);
