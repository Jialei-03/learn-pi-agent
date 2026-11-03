// 第 19 章实验：按行分帧，到底按什么“行”切？
//   node labs/ch19/framing.ts
// JSON 字符串里可以原样出现 U+2028（行分隔符）和 U+2029（段分隔符），JSON.stringify 不会转义它们。
// 同一行 JSONL，交给三种常见的“按行读取”方式。
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';

const LS = String.fromCharCode(0x2028);
const line = JSON.stringify({ type: 'prompt', message: `第一段${LS}第二段` });
const show = (s: string) => s.replaceAll(LS, '⟨U+2028⟩');
console.log(`这一行 JSONL：${show(line)}`);
console.log(`其中真正的换行符 \\n：${line.split('\n').length - 1} 个；U+2028：${line.split(LS).length - 1} 个\n`);

// ① Node.js 的 readline
const pieces: string[] = [];
await new Promise<void>(resolve => createInterface({ input: Readable.from([`${line}\n`]) }).on('line', l => pieces.push(l)).on('close', resolve));
console.log(`Node ${process.version} 的 readline：切成 ${pieces.length} 段 → ${pieces.length === 1 ? '解析正常' : '解析失败'}`);

// ② Python 的 str.splitlines()（很多人写客户端时的第一反应）
const py = spawnSync('python3', ['-c', 'import sys, json\nfor p in sys.stdin.buffer.read().decode().splitlines():\n  try: json.loads(p); print("ok")\n  except Exception as e: print("fail", type(e).__name__)'], { input: `${line}\n`, encoding: 'utf8' });
const results = py.stdout.trim().split('\n');
console.log(`Python 的 str.splitlines()：切成 ${results.length} 段 → ${results.join('、')}`);

// ③ 只按字节里的 \n 切
const bytes = Buffer.from(`${line}\n`);
const parts = bytes.toString('utf8').split('\n').filter(Boolean);
console.log(`按字节找 \\n：切成 ${parts.length} 段 → ${JSON.parse(parts[0]).message === `第一段${LS}第二段` ? '解析正常' : '解析失败'}`);
