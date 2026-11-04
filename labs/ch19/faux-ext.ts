// 第 19 章实验：给真实的 Pi 进程用的脚本模型。
// Pi 的命令行没有“用脚本当模型”的开关，但扩展可以注册模型提供方：
//   node …/pi-coding-agent/dist/cli.js --mode rpc -e labs/ch19/faux-ext.ts --provider faux --model faux-1
// 脚本和 labs/ch19/script.ts（mox 用的）一致：先调用一次 bash，再根据有没有收到“警告”插话回答。
// 环境变量 CH19_TOOL_SECONDS 决定 bash 要跑多久（实验用它制造“运行中”的时间窗口）。
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@earendil-works/pi-ai/compat';

export default function (pi: any) {
  // 扩展随手写的一行日志：RPC 模式下它去了哪里？（第 19 章 wire.ts 会检查）
  console.log('[faux-ext] 这是扩展里的 console.log');
  const seconds = process.env.CH19_TOOL_SECONDS ?? '0.6';
  const faux = registerFauxProvider({});
  const users = (context: any) => context.messages.filter((m: any) => m.role === 'user').map((m: any) => (typeof m.content === 'string' ? m.content : m.content.map((b: any) => b.text ?? '').join('')));
  const tool = () => fauxAssistantMessage(fauxToolCall('bash', { command: `sleep ${seconds} && echo "build ok"` }, { id: 'b1' }), { stopReason: 'toolUse' });
  const answer = (context: any) => fauxAssistantMessage(users(context).some((t: string) => t.includes('警告')) ? '收到：构建输出里没有警告。' : '构建完成。');
  faux.setResponses([tool, answer, tool, answer, tool, answer]);
  const model = faux.getModel();
  pi.registerProvider(model.provider, {
    baseUrl: model.baseUrl, apiKey: 'faux-key', api: faux.api,
    models: faux.models.map((m: any) => ({ id: m.id, name: m.name, api: m.api, reasoning: m.reasoning, input: m.input, cost: m.cost, contextWindow: m.contextWindow, maxTokens: m.maxTokens, baseUrl: m.baseUrl })),
  });
}
