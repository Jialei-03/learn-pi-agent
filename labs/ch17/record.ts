// 录制第 17 章的真实运行（需要 MOX_API_KEY，不在网站构建时运行；结果存成 recorded/live-run.json，live.ts 回放）。
//   eval "$(python3 …)"; export MOX_MODEL=MiniMax-M3.1-Flash
//   node labs/ch17/record.ts
// 在 mox 目录里运行 mox -p，让真实模型把调研交给 task 子 Agent；会话文件保存在临时的 HOME 里，运行后读出来。
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const cwd = join(repo, 'mox');
const home = mkdtempSync(join(tmpdir(), 'ch17-rec-'));
const prompt = process.argv[2] ?? '请用 task 子 Agent 调研：上下文压缩是在哪个文件里实现的，按什么规则决定从哪条消息切开？只要结论和代码位置。';
if (!process.env.MOX_API_KEY || !process.env.MOX_MODEL) throw new Error('需要设置 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL');

const started = Date.now();
const child = spawn(process.execPath, [join(cwd, 'src/cli.ts'), '-p', prompt, '--yolo'], { cwd, env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', d => (output += d));
child.stderr.on('data', d => (output += d));
const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
const code = await new Promise<number | null>(resolve => child.on('close', resolve));
clearTimeout(timer);

// 会话文件：主会话里实际留下了什么
const sessions = join(home, '.mox', 'sessions');
const dir = join(sessions, readdirSync(sessions)[0]);
const records = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8').trim().split('\n').map(l => JSON.parse(l).message);

const clean = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').replaceAll(repo.replace(/\/$/, ''), '<课程仓库>').replaceAll(home, '<HOME>').replaceAll(` ${userInfo().username} `, ' user ');
const recording = {
  recordedWith: `mox ${process.env.MOX_MODEL}`,
  recordedAt: new Date().toISOString().slice(0, 10),
  command: `cd mox && mox -p ${JSON.stringify(prompt)} --yolo`,
  exitCode: code,
  seconds: Math.round((Date.now() - started) / 1000),
  output: clean(output),
  session: records.map((m: any) => ({
    role: m.role,
    toolCalls: (m.tool_calls ?? []).map((c: any) => ({ name: c.function.name, arguments: clean(c.function.arguments) })),
    chars: (m.content ?? '').length,
    content: m.role === 'user' || m.role === 'tool' || m.role === 'assistant' ? clean(String(m.content ?? '')) : undefined,
  })),
};
writeFileSync(new URL('./recorded/live-run.json', import.meta.url), `${JSON.stringify(recording, null, 2)}\n`);
console.log(clean(output).split('\n').slice(0, 60).join('\n'));
console.log(`\n退出码 ${code}，用时 ${recording.seconds} 秒，主会话 ${records.length} 条记录`);
