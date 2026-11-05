// 录制一次真实运行（需要 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL；网站构建时不运行，只读它生成的 JSON）。
//   MOX_BASE_URL=https://api.minimaxi.com/v1 MOX_API_KEY=… MOX_MODEL=MiniMax-M3.1-Flash node labs/ch05/record.ts
// 做法：把有 bug 的示例项目复制到临时目录，用空的 HOME 启动真正的 mox 命令行（-p 一次性模式，--yolo 跳过确认），
// 跑完后从会话 JSONL 里取出这次运行的全部消息，存成 recorded/fix-bug.json。回放见 replay.ts。
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const prompt = '运行 node test.js，修好失败的测试';
const project = realpathSync(mkdtempSync(join(tmpdir(), 'record-project-')));
const home = realpathSync(mkdtempSync(join(tmpdir(), 'record-home-')));
cpSync(new URL('../fixtures/calc-bug', import.meta.url), project, { recursive: true });

const started = Date.now();
const run = spawnSync(process.execPath, [new URL('../../mox/src/cli.ts', import.meta.url).pathname, '-p', prompt, '--yolo'], {
  cwd: project, env: { ...process.env, HOME: home }, encoding: 'utf8',
});
if (run.status !== 0) throw new Error(`mox 运行失败（退出码 ${run.status}，信号 ${run.signal}，${run.error}）\n${run.stderr}`);

const sessions = join(home, '.mox', 'sessions');
const file = join(sessions, readdirSync(sessions)[0], readdirSync(join(sessions, readdirSync(sessions)[0]))[0]);
const messages = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).message);

// 清理：临时目录换成占位符，用户名换成 user，确保没有 Key
const clean = (text: string) => text.replaceAll(project, '<项目目录>').replaceAll(home, '<HOME>').replaceAll(process.env.USER ?? '\0', 'user');
const json = clean(JSON.stringify({
  model: process.env.MOX_MODEL, recordedAt: new Date().toISOString().slice(0, 10),
  command: `mox -p "${prompt}" --yolo`, prompt, fixture: 'labs/fixtures/calc-bug',
  seconds: Math.round((Date.now() - started) / 1000), messages,
}, null, 2));
if (process.env.MOX_API_KEY && json.includes(process.env.MOX_API_KEY)) throw new Error('录制文件里出现了 Key');
writeFileSync(new URL('./recorded/fix-bug.json', import.meta.url), `${json}\n`);
console.log(`已录制 ${messages.length} 条消息，用时 ${Math.round((Date.now() - started) / 1000)} 秒`);
