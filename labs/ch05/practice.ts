// 第 5 章实战检验：mox 的七个 coding 工具写对了吗？
//   node labs/ch05/practice.ts                 检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch05/practice.ts  检验你自己写的
// 在临时目录里逐个调用 read、write、edit、bash、grep、find、ls，检查它们的边界行为，打印模型会看到什么。
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMox, whose } from '../shared/mox-dir.ts';

const { codingTools } = await loadMox('tools.ts');
console.log(`${whose()}\n`);

const dir = mkdtempSync(join(tmpdir(), 'ch05-practice-'));
const put = (path: string, text: string) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text); };
const tool = Object.fromEntries(codingTools(dir).map((t: any) => [t.name, t]));
assert.deepEqual(Object.keys(tool).sort(), ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);   // 名字和 Pi 一致
const call = async (name: string, args: object, signal?: AbortSignal) => { try { return { text: String(await tool[name].run(args, signal)), error: false }; } catch (e) { return { text: (e as Error).message, error: true }; } };

const rows: [string, string][] = [];
const check = (name: string, seen: string, ok: boolean) => { rows.push([name, `${ok ? '✓' : '✗'} ${seen.replace(/\s+/g, ' ').slice(0, 90)}`]); assert.ok(ok, `${name}：${seen}`); };

// ── read ──
put('big.log', Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join('\n'));
let r = await call('read', { path: 'big.log' });
check('read：最多 2000 行，末尾提示怎样接着读', r.text.split('\n').at(-1)!, r.text.startsWith('line 1\n') && r.text.includes('line 2000') && !r.text.includes('line 2001') && r.text.includes('offset=2001'));
r = await call('read', { path: 'big.log', offset: 4999 });
check('read：读到文件末尾就没有提示，也没有行号前缀', r.text, r.text === 'line 4999\nline 5000');
r = await call('read', { path: 'big.log', offset: 9999 });
check('read：offset 超出文件长度，报错', r.text, r.error);
put('zh.txt', Array.from({ length: 100 }, (_, i) => `${i + 1}:` + '汉'.repeat(1000)).join('\n'));
r = await call('read', { path: 'zh.txt' });
check('read：50KB 按字节算（汉字一个三字节），只留整行', `${Buffer.byteLength(r.text)} 字节`, Buffer.byteLength(r.text) < 52_000 && r.text.includes('offset=18'));

// ── write ──
r = await call('write', { path: 'a/b/new.txt', content: 'hello' });
check('write：自动创建上级目录', r.text, !r.error && readFileSync(join(dir, 'a/b/new.txt'), 'utf8') === 'hello');

// ── edit ──
put('calc.js', 'function add(a, b) {\n  return a - b;\n}\nfunction sub(a, b) {\n  return a - b;\n}\n');
r = await call('edit', { path: 'calc.js', edits: [{ oldText: 'return a - b;', newText: 'return a + b;' }] });
check('edit：oldText 出现两次，报错并要求更多上下文', r.text, r.error && r.text.includes('2') && readFileSync(join(dir, 'calc.js'), 'utf8').includes('return a - b;\n}\nfunction sub'));
r = await call('edit', { path: 'calc.js', edits: [{ oldText: '不存在', newText: 'x' }] });
check('edit：oldText 找不到，报错', r.text, r.error);
r = await call('edit', { path: 'calc.js', edits: [{ oldText: 'function add(a, b) {\n  return a - b;', newText: 'function add(a, b) {\n  return a + b;' }, { oldText: 'function sub(a, b) {\n  return a - b;', newText: 'function sub(a, b) {\n  return a - b; // 保持' }] });
check('edit：一次改两处，都对照原文件匹配', r.text, !r.error && readFileSync(join(dir, 'calc.js'), 'utf8').includes('a + b;') && readFileSync(join(dir, 'calc.js'), 'utf8').includes('// 保持'));
put('o.txt', 'abcdef\n');
r = await call('edit', { path: 'o.txt', edits: [{ oldText: 'abc', newText: '1' }, { oldText: 'cde', newText: '2' }] });
check('edit：两处重叠，报错，文件不变', r.text, r.error && readFileSync(join(dir, 'o.txt'), 'utf8') === 'abcdef\n');
put('p.txt', 'price = 0\n');
await call('edit', { path: 'p.txt', edits: [{ oldText: 'price = 0', newText: 'price = "$&"' }] });
check('edit：newText 里的 $& 原样写入', readFileSync(join(dir, 'p.txt'), 'utf8'), readFileSync(join(dir, 'p.txt'), 'utf8').includes('"$&"'));

// ── bash ──
r = await call('bash', { command: 'echo hi' });
check('bash：输出带退出码', r.text, !r.error && r.text.includes('hi') && r.text.includes('0'));
r = await call('bash', { command: 'echo 失败了 >&2; exit 3' });
check('bash：退出码非 0 是错误，输出和退出码都在里面', r.text, r.error && r.text.includes('失败了') && r.text.includes('3'));
const tag = `3.${Date.now() % 1000 + 300}`;
const alive = () => { try { return execSync(`pgrep -f "[s]leep ${tag}"`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length; } catch { return 0; } };
const start = performance.now();
let took = 0;
const pending = call('bash', { command: `sleep ${tag} & sleep ${tag}; wait`, timeout: 1 }).then(x => { took = (performance.now() - start) / 1000; return x; });
await new Promise(res => setTimeout(res, 1500));
const left = alive();
r = await pending;
check('bash：超时 1 秒，连后台子进程一起杀掉，按时返回', `${r.text}（约 ${took.toFixed(1)} 秒，剩 ${left} 个子进程）`, r.error && left === 0 && took < 2);
const controller = new AbortController();
setTimeout(() => controller.abort(), 300);
const t2 = performance.now();
r = await call('bash', { command: 'sleep 3.9' }, controller.signal);
check('bash：取消信号触发后立刻返回', `${r.text}（约 ${((performance.now() - t2) / 1000).toFixed(1)} 秒）`, r.error && performance.now() - t2 < 1500);

// ── ls / find / grep ──
put('src/app.ts', 'export const a = 1; // TODO: 换成配置项\n');
put('node_modules/lib/index.js', '// TODO: lib 自己的待办\n');
put('.git/config', '[core] # TODO\n');
r = await call('ls', {});
check('ls：目录名后带 /，按字母排序', r.text, r.text.split('\n').includes('src/') && r.text.split('\n').includes('node_modules/'));
r = await call('find', { pattern: '*.js' });
check('find：按 glob 找，不进 node_modules', r.text, r.text.split('\n').includes('calc.js') && !r.text.includes('node_modules'));
r = await call('grep', { pattern: 'TODO' });
check('grep：路径:行号: 内容，不搜 .git 和 node_modules', r.text, r.text === 'src/app.ts:1: export const a = 1; // TODO: 换成配置项');
r = await call('grep', { pattern: 'line', path: 'big.log', limit: 2 });
check('grep：超过 limit 时说明上限', r.text, r.text.split('\n').length === 3 && r.text.includes('2'));

console.log('| 检查项 | 模型会看到 |');
console.log('| --- | --- |');
for (const [name, seen] of rows) console.log(`| ${name} | ${seen.replace(/\|/g, '/')} |`);
