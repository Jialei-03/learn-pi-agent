// 第 18 章实验：mox 的后台命令。模型启动一个要跑一会儿的构建，先结束这一轮；构建结束时，扩展在 agent_end 里把结局交给它。
//   node labs/ch18/background.ts
// 跑的是真正的 mox 命令行（mox -p），加载 extensions/background/mox.ts；模型是一个照剧本说话的假服务器，它记下每次请求到达的时刻。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMox, type CliScript } from '../shared/mox-cli.ts';

const extension = fileURLToPath(new URL('../../extensions/background/mox.ts', import.meta.url));
const temp = (name: string) => mkdtempSync(join(tmpdir(), `ch18-${name}-`));
// 一个“构建”：每 150ms 输出一行，0.9 秒后以退出码 0 结束
const buildScript = "let i = 0;\nconst t = setInterval(() => { console.log('building module ' + (++i)); if (i === 6) { clearInterval(t); console.log('BUILD OK'); } }, 150);\n";
const build = 'node build.js';
const lastUser = (messages: any[]) => messages.filter(m => m.role === 'user').at(-1).content as string;

// ── ① notify：说完话之后，扩展等到构建结束，再把结局当作下一句话 ──
const arrivals: number[] = [];
const script: CliScript = ({ messages }, n) => {
  arrivals.push(Date.now());
  if (n === 1) return { toolCalls: [{ name: 'bash_background', arguments: { command: build, notify: true } }] };
  if (n === 2) return { toolCalls: [{ name: 'bash_output', arguments: { id: 1 } }] };
  if (n === 3) return { text: '构建在后台进行，结束时我会收到通知。你可以先告诉我下一步做什么。' };
  return { text: `收到通知：${lastUser(messages).includes('BUILD OK') ? '构建成功（BUILD OK）' : '构建结束'}，可以继续部署了。` };
};
const cwd1 = temp('cwd');
writeFileSync(join(cwd1, 'build.js'), buildScript);
const first = await runMox(['-p', '构建一下项目', '--yolo', '-e', extension], { cwd: cwd1, home: temp('home'), script });
const gap = (i: number) => (arrivals[i] - arrivals[i - 1]) / 1000;

console.log('模型的四次请求：\n');
console.log('| # | 距上一次请求 | 模型这次看到的最后一条消息 |\n| --- | --- | --- |');
first.requests.map(r => r.messages.at(-1)).forEach((m, i) => {
  const text = (m.content as string).replace(/\s+/g, ' ');
  console.log(`| ${i + 1} | ${i === 0 ? '—' : gap(i) < 0.3 ? '几乎立刻' : '约 1 秒（构建的时长）'} | ${m.role === 'tool' ? '工具结果：' : '用户：'}${text.slice(0, 70)}${text.length > 70 ? '…' : ''} |`);
});
console.log(`\nmox 的终端输出（去掉颜色）：\n${first.output.trim().split('\n').map(l => `  ${l.slice(0, 100)}`).join('\n')}`);

// ── ② 不设 notify（开发服务器这类不会结束的命令）：不等；mox 退出时 shutdown 事件把它杀掉 ──
const cwd2 = temp('cwd2');
const server: CliScript = (_r, n) => (n === 1
  ? { toolCalls: [{ name: 'bash_background', arguments: { command: 'echo $$ > pid.txt; sleep 60' } }] }
  : { text: '开发服务器已经在后台启动，我们继续。' });
const started = Date.now();
const second = await runMox(['-p', '启动开发服务器', '--yolo', '-e', extension], { cwd: cwd2, home: temp('home2'), script: server });
const seconds = (Date.now() - started) / 1000;
const pid = Number(readFileSync(join(cwd2, 'pid.txt'), 'utf8'));
await new Promise(r => setTimeout(r, 300));
const alive = (() => { try { process.kill(pid, 0); return true; } catch { return false; } })();
console.log(`\n不设 notify 的 sleep 60：mox ${seconds < 10 ? '立刻' : '很久之后'}就退出了（没有等它），退出码 ${second.code}；mox 退出后，那条命令的进程${alive ? '还活着' : '已经不在了'}。`);

// 正文的结论
assert.equal(first.code, 0);
assert.equal(first.requests.length, 4, '一共四次模型请求');
assert.ok(gap(1) < 0.5 && gap(2) < 0.5, '前三次请求紧挨着：模型启动命令、看一眼、说完话');
assert.ok(gap(3) >= 0.7, `第四次请求等到构建结束才发出（${gap(3)} 秒）：等待期间没有任何模型请求`);
assert.match(lastUser(first.requests[3].messages), /BUILD OK/);
assert.match(lastUser(first.requests[3].messages), /退出码 0/);
assert.equal(second.code, 0);
assert.ok(seconds < 10, 'mox 没有被 60 秒的命令拖住');
assert.equal(alive, false, 'shutdown 事件杀掉了后台命令');
