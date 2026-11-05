// 第 18 章实验：进程在工具执行期间被杀死，重启后怎么继续？跑的是真正的 mox 命令行。
//   node labs/ch18/crash.ts
// ① mox -p 执行部署：模型一次发出三个调用（读 README、部署并等待、读源码）。部署命令把一行写进 deploy.log 之后还在 sleep，这时 kill -9。
// ② 看会话文件里留下了什么。③ 朴素的恢复：把没有结果的调用重新执行。④ mox 的恢复：mox -c 打开会话，session.ts 给没有结果的调用补“中断”。
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codingTools } from '../../mox/src/tools.ts';
import { killGroup, spawnMox, startFakeModel, type CliScript } from '../shared/mox-cli.ts';

const root = mkdtempSync(join(tmpdir(), 'ch18-crash-'));
const cwd = join(root, 'project'), home = join(root, 'home');
mkdirSync(join(cwd, 'src'), { recursive: true });
writeFileSync(join(cwd, 'README.md'), '# demo\n部署：echo 部署 v2 >> deploy.log\n');
writeFileSync(join(cwd, 'src', 'app.js'), "console.log('app');\n");
const deploys = (dir: string) => (existsSync(join(dir, 'deploy.log')) ? readFileSync(join(dir, 'deploy.log'), 'utf8').trim().split('\n').length : 0);
const deploy = 'echo "部署 v2" >> deploy.log && sleep 30';

// ① 第一次运行：部署命令的效果已经发生（deploy.log 有了一行），命令本身还在 sleep 的时候，整个进程组被 kill -9
const crashing: CliScript = () => ({ toolCalls: [
  { id: 'c1', name: 'read', arguments: { path: 'README.md' } },
  { id: 'c2', name: 'bash', arguments: { command: deploy } },
  { id: 'c3', name: 'read', arguments: { path: 'src/app.js' } },
] });
const first = await startFakeModel(crashing);
const run = spawnMox(['-p', '部署 v2，然后等它跑完', '--yolo'], { cwd, home, url: first.url });
while (!existsSync(join(cwd, 'deploy.log'))) await new Promise(r => setTimeout(r, 20));
killGroup(run);
await run.done;
first.close();

// ② 会话文件：消息一产生就追加，所以被杀时已经发生的事都在里面
const dir = join(home, '.mox', 'sessions'), sessionDir = join(dir, readdirSync(dir)[0]);
const file = join(sessionDir, readdirSync(sessionDir)[0]);
const records = () => readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l).message);
const unanswered = (messages: any[]) => {
  const answered = new Set(messages.filter(m => m.role === 'tool').map(m => m.tool_call_id));
  return messages.flatMap(m => m.tool_calls ?? []).map((c: any) => c.id).filter((id: string) => !answered.has(id));
};
const brief = (m: any) => (m.role === 'assistant' ? `assistant（${m.tool_calls.length} 个工具调用）` : m.role === 'tool' ? `tool(${m.tool_call_id})` : m.role);
console.log('━━ kill -9 之后 ━━');
console.log(`会话记录：${records().map(brief).join(' → ')}`);
console.log(`没有结果的调用：${unanswered(records()).join('、')}`);
console.log(`deploy.log：${deploys(cwd)} 行——部署的效果已经发生了；c3（读源码）其实还没有开始，可是会话里它和 c2 看起来一模一样：都没有结果`);
assert.deepEqual(records().map(m => m.role), ['user', 'assistant', 'tool']);
assert.deepEqual(unanswered(records()), ['c2', 'c3']);
assert.equal(deploys(cwd), 1);

// ③ 朴素的做法：把没有结果的调用全部重新执行（在项目的副本上试，部署命令只给 1 秒）
const copy = join(root, 'naive');
cpSync(cwd, copy, { recursive: true });
const calls = records()[1].tool_calls.filter((c: any) => unanswered(records()).includes(c.id));
for (const call of calls) {
  const args = JSON.parse(call.function.arguments);
  // 部署命令后面跟着 sleep 30：只给它 1 秒，超时被杀会抛出错误，效果（deploy.log 多一行）已经发生了
  try { await codingTools(copy).find(t => t.name === call.function.name)!.run(call.function.name === 'bash' ? { ...args, timeout: 1 } : args); } catch { /* 超时被杀 */ }
}
console.log(`\n━━ 朴素做法：全部重新执行 ━━\ndeploy.log：${deploys(copy)} 行——同一次部署执行了两遍`);
assert.equal(deploys(copy), 2);

// ④ mox 的做法：mox -c 恢复这个会话。session.ts 给没有结果的调用补一条“中断”，对话才是合法的
const resumed: CliScript = ({ messages }, n) => (n === 1
  ? { toolCalls: [{ name: 'bash', arguments: { command: 'cat deploy.log' } }] }
  : { text: `deploy.log 里已经有“部署 v2”：部署命令在中断前已经执行，不再重复。（${messages.filter(m => m.role === 'tool').length} 个工具结果）` });
const second = await startFakeModel(resumed);
const again = spawnMox(['-c', '-p', '继续刚才的部署', '--yolo'], { cwd, home, url: second.url });
await again.done;
second.close();
const seen = second.requests[0].messages;
console.log('\n━━ mox 的做法 ━━\n恢复后第一次请求，模型看到的对话（system 之后）：');
for (const m of seen.slice(1)) console.log(`  ${brief(m).padEnd(24)}${m.role === 'tool' ? String(m.content).split('\n')[0].slice(0, 40) : m.role === 'user' ? m.content : ''}`);
console.log(`\n补上之前，这份对话里有 ${unanswered(records().slice(0, 3)).length} 个没有结果的调用——OpenAI 兼容的接口会直接返回 400；补上之后是 ${unanswered(seen).length} 个。`);
console.log(`模型先查 deploy.log，然后：${again.output().trim().split('\n').at(-1)}`);
console.log(`deploy.log：${deploys(cwd)} 行`);
assert.equal(unanswered(seen).length, 0);
assert.deepEqual(seen.filter((m: any) => m.role === 'tool').map((m: any) => m.content.startsWith('中断')), [false, true, true]);
assert.equal(deploys(cwd), 1, 'mox 的做法：模型查证之后没有重复部署');
