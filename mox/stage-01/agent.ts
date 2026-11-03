// 第 1 章：最小 Agent。一个文件，零依赖，Node 22.19+ 直接运行。
//
//   node mox/stage-01/agent.ts "这个项目是做什么的？"
//
// 没有配置 API Key 时使用脚本模型（决策写死，只用于演示）。
// 使用任何 OpenAI 兼容的服务（OpenAI、DeepSeek、通义、Kimi、本地 Ollama 等）：
//   export MOX_BASE_URL=https://api.deepseek.com/v1   # 以服务商文档为准
//   export MOX_API_KEY=sk-...
//   export MOX_MODEL=deepseek-chat
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { scriptedModel } from './scripted-model.ts';

// ── 1. 工具：告诉模型“你能做什么”的说明书 ─────────────────────────────
export const tools = [
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '列出目录中的文件和子目录',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取一个文本文件的全部内容',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '文件路径' } }, required: ['path'] },
    },
  },
];

// ── 2. 工具的实现：真正动手的是我们的代码，不是模型 ────────────────────
const handlers: Record<string, (args: { path: string }) => string> = {
  list_dir: ({ path }) => readdirSync(path, { withFileTypes: true }).map(e => (e.isDirectory() ? e.name + '/' : e.name)).join('\n'),
  read_file: ({ path }) => readFileSync(path, 'utf8'),
};

// ── 3. 调用模型：一次普通的 HTTP 请求，模型本身不保存任何状态 ───────────
export type ChatMessage = Record<string, any>;
export type CallModel = (messages: ChatMessage[]) => Promise<ChatMessage>;

export const callOpenAICompatible: CallModel = async messages => {
  const base = process.env.MOX_BASE_URL ?? 'https://api.openai.com/v1';
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.MOX_API_KEY}` },
    body: JSON.stringify({ model: process.env.MOX_MODEL ?? 'gpt-4o-mini', messages, tools }),
  });
  if (!response.ok) throw new Error(`模型请求失败：HTTP ${response.status} ${await response.text()}`);
  const data = (await response.json()) as { choices: { message: ChatMessage }[] };
  return data.choices[0].message; // { role: 'assistant', content, tool_calls? }
};

// ── 4. Agent Loop：问模型 → 执行工具 → 结果放回历史 → 再问 ─────────────
export const SYSTEM = '你是一个帮助用户理解代码仓库的助手。需要时使用工具查看文件，回答要简洁。';

export async function runAgent(prompt: string, callModel: CallModel, onRequest?: (messages: ChatMessage[]) => void) {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: prompt },
  ];
  const MAX_TURNS = 10; // 保护钱包的安全阀；第 3 章会讨论为什么它不该写死在循环里
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    onRequest?.(structuredClone(messages));
    const reply = await callModel(messages);              // ① 把完整历史发给模型
    messages.push(reply);                                  // ② 回复进入历史
    if (!reply.tool_calls?.length) return { answer: reply.content as string, messages };
    for (const call of reply.tool_calls) {                 // ③ 模型请求了工具：由我们执行
      const args = JSON.parse(call.function.arguments);
      const output = handlers[call.function.name](args);
      messages.push({ role: 'tool', tool_call_id: call.id, content: output }); // ④ 结果放回历史
    }
  }
  throw new Error(`超过 ${MAX_TURNS} 轮仍未结束`);
}

// ── 命令行入口 ──────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prompt = process.argv.slice(2).join(' ') || '这个项目是做什么的？';
  const live = Boolean(process.env.MOX_API_KEY);
  console.error(live ? `[真实模型 ${process.env.MOX_MODEL ?? 'gpt-4o-mini'}]` : '[脚本模型：未设置 MOX_API_KEY，决策是写死的]');
  const { answer, messages } = await runAgent(prompt, live ? callOpenAICompatible : scriptedModel, sent => {
    const calls = sent.filter(m => m.role === 'tool').length;
    console.error(`→ 第 ${sent.filter(m => m.role === 'assistant').length + 1} 次请求：${sent.length} 条消息，其中 ${calls} 条工具结果`);
  });
  console.log('\n' + answer);
  if (process.argv.includes('--dump')) console.log(JSON.stringify(messages, null, 2));
}
