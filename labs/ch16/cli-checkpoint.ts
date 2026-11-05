// 第 16 章实验：检查点接进真正的 mox 命令行（借伪终端，像用户那样输入命令、回答提问）。
//   node labs/ch16/cli-checkpoint.ts
// 模型是脚本，命令行、扩展、工具和影子仓库都是真的。
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { callsInOrder, runCli } from '../ch14/cli-run.ts';

const ext = (name: string) => ['-e', join(process.cwd(), `extensions/${name}/mox.ts`)];
const show = (title: string, outcomes: { ok: boolean; what: string; result: string }[]) => {
  console.log(`━━ ${title} ━━`);
  for (const o of outcomes) console.log(`${o.ok ? '✓' : '✗'} ${o.what.slice(0, 30).padEnd(30)} ${o.result.replace(/\s+/g, ' ').replace(/^错误：/, '').slice(0, 60)}`);
  console.log();
};

// 检查点：两次写入，/rewind 回到第一次之前。菜单里最新的在最前面，所以输入 2 是第一次写入
const rewind = await runCli({
  script: callsInOrder([{ name: 'write', arguments: { path: 'src/list.ts', content: 'export {};\n' } }, { name: 'bash', arguments: { command: "echo '用法：mox list' >> README.md" } }]),
  prompt: ['加一个 list 命令', '/rewind', '收到'],
  flags: ['--yolo', ...ext('checkpoint')],
  answers: ['2'],
  project: { 'README.md': '# notes\n' },
});
show('mox --yolo -e checkpoint：两次写入，/rewind 选第 2 项', rewind.outcomes);
console.log(`/rewind 之后：src/list.ts ${rewind.exists('src/list.ts') ? '还在' : '不在了'}`);
assert.ok(!rewind.exists('src/list.ts'), 'src/list.ts 是第一次写入创建的，回到它之前就不存在了');
// 恢复之后的下一次运行，系统提示里有一句话告诉模型磁盘变了
const lastSystem = rewind.requests.at(-1)!.messages[0].content!;
console.log(`下一次提问时，系统提示里有 /rewind 的说明：${lastSystem.includes('/rewind') ? '有' : '没有'}`);
assert.ok(lastSystem.includes('/rewind'));
