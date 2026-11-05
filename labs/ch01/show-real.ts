// 第 1 章：把真实模型那次运行（recorded/first-run.json）整理成表。只读文件，不联网。
//   node labs/ch01/show-real.ts
// 重新录制：node labs/ch01/record.ts（需要 MOX_BASE_URL / MOX_API_KEY / MOX_MODEL，会产生真实用量）
import { readFileSync } from 'node:fs';

const record = JSON.parse(readFileSync(new URL('./recorded/first-run.json', import.meta.url), 'utf8'));
console.log(`模型 ${record.model}，${record.captured_at} 录制；问题：${record.prompt}\n`);

console.log('| 请求 | 发送的消息 | finish | 模型这次回复了什么 | 随后执行的工具 |\n| --- | --- | --- | --- | --- |');
record.requests.forEach((r: any, i: number) => {
  const reply = record.messages[r.messages - 1];                       // 请求 1 带 system 共 2 条，对应历史下标 1
  const calls = (reply.tool_calls ?? []).map((c: any) => `${c.function.name} ${c.function.arguments}`.replaceAll('|', '\\|'));
  const said = reply.content ? reply.content.replace(/\s+/g, ' ').slice(0, 40) + (reply.content.length > 40 ? '…' : '') : '（没有文字）';
  console.log(`| 第 ${i + 1} 次 | ${r.messages} 条 | ${r.finish} | ${said} | ${calls.length ? calls.map((c: string) => `\`${c}\``).join('<br>') : '无，循环结束'} |`);
});
const toolCalls = record.messages.filter((m: any) => m.role === 'tool').length;
console.log(`\n一句提问：${record.requests.length} 次请求，${toolCalls} 次工具执行，最后历史里共 ${record.messages.length} 条消息。`);
