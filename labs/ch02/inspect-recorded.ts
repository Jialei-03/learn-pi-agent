// 第 2 章：看看真实模型的流和教科书里的流有什么不同（只读 recorded/ 里的文件，不联网）。
//   node labs/ch02/inspect-recorded.ts
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('./recorded/minimax-m31-flash-stream.sse', import.meta.url), 'utf8');
const lines = raw.split('\n').filter(l => l.startsWith('data:'));
const chunks = lines.filter(l => !l.includes('[DONE]')).map(l => JSON.parse(l.slice(5)));

const kinds: Record<string, number> = {};
for (const c of chunks) {
  const choice = c.choices?.[0];
  const d = choice?.delta ?? {};
  const kind = d.reasoning_content ? 'delta.reasoning_content（思考）' : d.content ? 'delta.content（正文）' : d.tool_calls ? 'delta.tool_calls（工具调用）' : choice?.finish_reason ? 'finish_reason' : '只有 role 的开场块';
  kinds[kind] = (kinds[kind] ?? 0) + 1;
}
console.log(`MiniMax-M3.1-Flash 的一次真实回复：${Buffer.byteLength(raw)} 字节，${lines.length} 个 data 行（含最后的 [DONE]）\n`);
console.log('| 块的种类 | 个数 |\n| --- | --- |');
for (const [kind, n] of Object.entries(kinds)) console.log(`| ${kind} | ${n} |`);

const thinking = chunks.map(c => c.choices?.[0]?.delta?.reasoning_content ?? '').join('');
console.log(`\n思考内容拼起来有 ${thinking.length} 个字符，开头是：${JSON.stringify(thinking.slice(0, 60))}`);
console.log('\n两个工具调用各占一块，参数是完整的 JSON（不像测试样本那样分片）：');
for (const c of chunks) for (const t of c.choices?.[0]?.delta?.tool_calls ?? []) console.log(`  index=${t.index} id=${t.id} ${t.function.name} ${t.function.arguments}`);
console.log(`\n最后一个有内容的块：finish_reason = ${chunks.find(c => c.choices?.[0]?.finish_reason).choices[0].finish_reason}；整个流里${chunks.some(c => c.usage && c.usage !== null) ? '有' : '没有'}带用量的块。`);
