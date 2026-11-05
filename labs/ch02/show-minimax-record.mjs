// Offline display of a real, sanitized observation. Never calls the API.
import { readFileSync } from 'node:fs';

const path = new URL('./recorded/minimax-m31-flash-2026-11-05.json', import.meta.url);
const record = JSON.parse(readFileSync(path, 'utf8'));
const first = record.first_response;
const chunks = first.visible_sse_deltas.filter(event => event.delta.tool_calls);
const call = first.tool_calls[0];
if (record.kind !== 'real-api-sanitized-observation' || !chunks.length || !call?.id || call.id !== record.tool_result_sent.tool_call_id || !record.second_response.content) {
  throw new Error('record is missing the verified tool-call round trip');
}
if (process.argv.includes('--markdown')) {
  const block = (value, lang = 'json') => console.log('```' + lang + '\n' + (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '\n```\n');
  console.log(`记录时间：${record.captured_at_utc}。API 返回模型：${first.model_reported}。以下读取已保存的真实记录，不联网。\n`);
  console.log('## 第一轮 SSE 工具调用增量\n');
  for (const event of chunks) block(event.delta);
  console.log('## 组装完成的工具调用\n');
  block(call);
  console.log('## 本地执行后回传的结果\n');
  block(record.tool_result_sent);
  console.log('## 第二轮模型回答\n');
  console.log(record.second_response.content + '\n');
  console.log(`工具调用 ID 与结果 ID 一致：${record.checks.tool_id_copied_from_response}。第一轮推理字段字符数：${first.reasoning_chars}。`);
  process.exit(0);
}
console.log('来源：MiniMax API 实际调用记录（脱敏；不是构建时请求模型）');
console.log(`时间：${record.captured_at_utc}`);
console.log(`模型：请求 ${record.model_requested}；API 返回 ${first.model_reported}`);
console.log('\n第一轮真实 SSE 中的工具调用增量：');
for (const event of chunks) console.log('data: ' + JSON.stringify(event.delta));
console.log('\n组装完成的工具调用：');
console.log(JSON.stringify(call, null, 2));
console.log('\n本地读文件后发回的工具结果：');
console.log(JSON.stringify(record.tool_result_sent, null, 2));
console.log('\n第二次真实模型回答：');
console.log(record.second_response.content);
console.log(`\n校验：两次使用同一 tool_call_id = ${record.checks.tool_id_copied_from_response}`);
console.log(`第一轮返回的 reasoning_content 字符数：${first.reasoning_chars}；原文未写入记录`);
