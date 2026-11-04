// 第 10 章实验：记忆在会话中途变化时，请求的前缀还在吗？
//   node labs/ch10/cache.ts
// 同一段对话（五次运行，第三次用户说“记住……”，模型保存一条记忆），用三种方式把记忆放进系统提示：
//   A  Pi 的分节补丁：扩展只修改 systemPromptOptions.sections.memory（本章的 extensions/memory/index.ts）
//   B  Pi 的整段替换：扩展在 before_agent_start 里返回完整的 systemPrompt
//   C  mox：记忆追加在系统提示末尾，每次运行重新生成整段系统提示（extensions/memory/mox.ts）
// 每次请求，我们计算它和上一次请求的“公共前缀”占多少（按字符，简化了服务商的实际规则，和第 6 章的实验一样）。
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createMemoryExtension } from '../../extensions/memory/index.ts';
import { createMemoryMoxExtension } from '../../extensions/memory/mox.ts';
import { MemoryStore, saveFromModel, userAskedToRemember } from '../../extensions/memory/store.ts';
import { createCodingTools } from '../../mox/src/coding/index.ts';
import { buildSystemPrompt } from '../../mox/src/context.ts';
import { ExtensionHost } from '../../mox/src/extensions.ts';
import { runLoop } from '../../mox/src/loop.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import type { Message } from '../../mox/src/types.ts';
import { createPiSession } from '../shared/pi-session.ts';

const prompts = ['先看看这个项目的结构。', '再看看 src 目录。', '记住：这个项目用 pnpm，不要用 npm，因为锁文件是 pnpm-lock.yaml。', '跑一下测试。', '再跑一次，看看有没有不稳定的用例。'];
const MEMORY = { name: 'package-manager', description: '这个项目用 pnpm，不用 npm', type: 'feedback', content: '运行脚本和安装依赖都用 pnpm。\n原因：锁文件是 pnpm-lock.yaml。' } as const;
const reply = (n: number) => `第 ${n} 次回复。` + '这个项目分成 src、test 和 scripts 三个目录，入口在 src/index.ts。'.repeat(8);   // 让历史有一定长度
const tmp = (name: string) => join(mkdtempSync(join(tmpdir(), 'ch10-')), name);
const commonPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
// 请求里真正发给服务商的只有角色和内容；用量、时间戳、随机的 api 标识是本地记录，不参与前缀比较（它们的长度每次运行都可能不同）
const LOCAL_FIELDS = new Set(['api', 'provider', 'model', 'usage', 'timestamp', 'durationMs', 'thinkingLevel', 'stopReason', 'responseId']);
const wire = (messages: unknown) => JSON.stringify(messages, (key, value) => (LOCAL_FIELDS.has(key) ? undefined : value));

/** 一次实验的结果：每次请求序列化之后的文本。 */
type Requests = string[];

// ── A、B：Pi ─────────────────────────────────────────────
// B 的扩展：工具和 A 一样，只是把记忆拼进完整的系统提示再返回——这是很多人写扩展时的第一反应。
const replaceWholePrompt = (dir: string) => (pi: any) => {
  const store = new MemoryStore(dir);
  let lastPrompt = '';
  pi.on('before_agent_start', (event: any) => {
    if (event.messageType === 'user') lastPrompt = event.prompt;
    return { systemPrompt: `${event.systemPrompt}\n\n<memory>\n${store.promptSection()}\n</memory>` };
  });
  pi.registerTool({
    name: 'save_memory', label: 'save_memory', description: '保存长期记忆', parameters: { type: 'object', properties: {} },
    async execute() {
      const explicit = userAskedToRemember(lastPrompt);
      saveFromModel(store, MEMORY, { explicit, confirmed: explicit });
      return { content: [{ type: 'text', text: '已保存。' }], details: {} };
    },
  });
};

async function runPi(extension: (pi: any) => void): Promise<Requests> {
  const requests: Requests = [];
  const record = (build: () => any) => (context: any) => { requests.push(wire(context.messages)); return build(); };
  const { session } = await createPiSession({
    extensions: [extension],
    responses: [
      record(() => fauxAssistantMessage(reply(1))),
      record(() => fauxAssistantMessage(reply(2))),
      record(() => fauxAssistantMessage(fauxToolCall('save_memory', MEMORY, { id: 's1' }), { stopReason: 'toolUse' })),
      record(() => fauxAssistantMessage('记住了。' + reply(3))),
      record(() => fauxAssistantMessage(reply(4))),
      record(() => fauxAssistantMessage(reply(5))),
    ],
  });
  for (const prompt of prompts) await session.prompt(prompt);
  session.dispose();
  return requests;
}

// ── C：mox ───────────────────────────────────────────────
async function runMox(): Promise<Requests> {
  const cwd = mkdtempSync(join(tmpdir(), 'ch10-mox-'));
  const host = new ExtensionHost(cwd, createCodingTools(cwd).map(t => t.name));
  await host.load('memory', createMemoryMoxExtension({ dir: tmp('memory') }));
  const tools = [...createCodingTools(cwd), ...host.tools];
  const base = await buildSystemPrompt({ cwd, tools });
  const requests: Requests = [];
  const model = scripted((context, n) => {
    // 序列化的顺序和 Anthropic 的缓存层级一致：工具声明 → 系统提示 → 消息
    requests.push(wire([context.tools, context.systemPrompt, context.messages]));
    if (n === 3) return { toolCalls: [{ id: 's1', name: 'save_memory', arguments: { ...MEMORY } }] };
    return { text: n === 4 ? '记住了。' + reply(3) : reply(n < 3 ? n : n - 1) };
  });
  const history: Message[] = [];
  for (const prompt of prompts) {
    const systemPrompt = await host.emitBeforeAgentStart(prompt, base);     // 每次运行重新生成整段系统提示（mox/src/cli.ts 的做法）
    const { messages } = await runLoop(history, [{ role: 'user', content: prompt }], { model, systemPrompt, tools, hooks: host.toolHooks() });
    history.push(...messages);
  }
  return requests;
}

const strategies = {
  A: await runPi(createMemoryExtension({ dir: tmp('memory') })),
  B: await runPi(replaceWholePrompt(tmp('memory'))),
  C: await runMox(),
};
assert.deepEqual(Object.values(strategies).map(r => r.length), [6, 6, 6]);

/** 第 i 次请求有多少比例和上一次请求相同（i 从 2 开始）。 */
const reuse = (requests: Requests, i: number) => commonPrefix(requests[i - 2], requests[i - 1]) / requests[i - 1].length;
const events = ['', '第 2 次运行', '第 3 次运行：用户说“记住”，模型调用 save_memory', '同一次运行：工具结果交回模型', '第 4 次运行：记忆已经变了', '第 5 次运行：记忆不再变化'];

console.log('| 请求 | 发生了什么 | A Pi：分节补丁 | B Pi：整段替换 | C mox：追加在末尾 |');
console.log('| --- | --- | --- | --- | --- |');
for (let i = 2; i <= 6; i++) {
  console.log(`| ${i} | ${events[i - 1]} | ${Object.values(strategies).map(r => `${Math.round(reuse(r, i) * 100)}%`).join(' | ')} |`);
}

// 结论：记忆变化后的第一次请求（第 5 次）里，A 的复用比例和平时差不多，B 和 C 掉了一大截——系统提示变了，后面的历史全部无法复用
const drop = (requests: Requests) => reuse(requests, 4) - reuse(requests, 5);
assert.ok(drop(strategies.A) < 0.05, 'A：补丁追加在历史末尾，之前的内容全部复用');
assert.ok(drop(strategies.B) > 0.3, 'B：系统提示变了，历史全部无法复用');
assert.ok(drop(strategies.C) > 0.3, 'C：系统提示变了，历史全部无法复用');
// 记忆不再变化之后（第 6 次），三种方式都恢复正常
for (const requests of Object.values(strategies)) assert.ok(reuse(requests, 6) > 0.8);
// A 的“补丁”确实是一条追加在历史末尾、只含 memory 小节的系统消息
const patch = JSON.parse(strategies.A[4]).filter((m: any) => m.role === 'system').at(-1);
assert.deepEqual(Object.keys(patch.sections), ['memory']);
console.log(`\nA 在第 4 次运行的开头追加了一条系统消息，它的 sections 只有：${Object.keys(patch.sections).join('、')}`);
