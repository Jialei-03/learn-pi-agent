// mox 的扩展系统（第 9 章）。设计与 Pi 的扩展 API 对应，但只保留最核心的几个事件。
// 一个扩展就是一个函数：拿到 api，用 api.on 订阅事件、api.registerTool 注册工具、api.registerCommand 注册命令。
// 对照 Pi：packages/coding-agent/src/core/extensions/（types.ts、runner.ts、loader.ts）
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AgentTool, ToolHooks, ToolResult } from './tools.ts';
import type { Message, ToolCall } from './types.ts';

export interface ExtensionContext {
  cwd: string;
  /** 让用户在几个选项中选一个（第 14 章）。交互模式才有；-p 模式下不存在，扩展要按“没人能确认”处理 */
  select?: (title: string, options: string[]) => Promise<string | undefined>;
}

/** 事件 → 处理函数可以返回什么。返回 undefined 表示“不干预”。 */
export interface EventMap {
  session_start: { event: { cwd: string }; result: void };
  /** 链式：后面的处理函数拿到前面改过的文本；返回 handled 表示这条输入已经处理完，不交给模型 */
  input: { event: { text: string }; result: { text?: string; handled?: boolean } | void };
  /** 链式：可以改写本次运行的系统提示 */
  before_agent_start: { event: { prompt: string; systemPrompt: string }; result: { systemPrompt?: string } | void };
  /** 闸门：第一个返回 block 的处理函数生效；也可以直接修改 event.input */
  tool_call: { event: { toolCall: ToolCall; toolName: string; input: Record<string, unknown> }; result: { block: true; reason?: string } | void };
  /** 链式：可以逐字段改写工具结果 */
  tool_result: { event: { toolCall: ToolCall; toolName: string; input: Record<string, unknown>; result: ToolResult }; result: Partial<ToolResult> | void };
  /** 通知：返回值被忽略 */
  agent_end: { event: { reason: string }; result: void };
  /**
   * 运行即将结束、Agent 准备停下时（第 13 章的 Stop 钩子、第 18 章的目标循环）。
   * 返回 followUp：不停下，把这段文字作为新的用户消息，再跑一轮。第一个返回 followUp 的处理函数生效
   */
  before_settle: { event: { messages: Message[] }; result: { followUp: string } | void };
  /** 通知：mox 退出前。持有外部资源（子进程、连接）的扩展在这里清理（第 12 章） */
  session_shutdown: { event: Record<string, never>; result: void };
}
export type EventName = keyof EventMap;
type Handler<K extends EventName> = (event: EventMap[K]['event'], ctx: ExtensionContext) => Promise<EventMap[K]['result']> | EventMap[K]['result'];

export interface Command { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }

export interface MoxExtensionAPI {
  on<K extends EventName>(event: K, handler: Handler<K>): void;
  registerTool(tool: AgentTool): void;
  /** 某个名字是否已经被内置工具或其他扩展占用 */
  hasTool(name: string): boolean;
  registerCommand(name: string, command: Command): void;
}

export type MoxExtension = (api: MoxExtensionAPI) => void | Promise<void>;

interface Loaded { name: string; handlers: { [K in EventName]?: Handler<K>[] } }

export class ExtensionHost {
  readonly tools: AgentTool[] = [];
  readonly commands = new Map<string, Command>();
  readonly errors: { extension: string; event: string; message: string }[] = [];
  private loaded: Loaded[] = [];
  private ctx: ExtensionContext;
  private reservedTools: Set<string>;

  /** reservedTools：内置工具的名字，扩展不能占用 */
  constructor(cwd: string, reservedTools: string[] = []) { this.ctx = { cwd }; this.reservedTools = new Set(reservedTools); }

  /** 宿主提供交互界面时调用 */
  setSelect(select: ExtensionContext['select']) { this.ctx.select = select; }

  /** 按顺序加载扩展。处理函数的执行顺序 = 扩展的加载顺序，同一扩展内 = 注册顺序。 */
  async load(name: string, extension: MoxExtension) {
    const entry: Loaded = { name, handlers: {} };
    const api: MoxExtensionAPI = {
      on: (event, handler) => { ((entry.handlers[event] ??= []) as Handler<typeof event>[]).push(handler); },
      registerTool: tool => {
        if (this.reservedTools.has(tool.name) || this.tools.some(t => t.name === tool.name)) throw new Error(`扩展 ${name} 注册的工具 ${tool.name} 与已有工具重名`);
        this.tools.push(tool);
      },
      hasTool: toolName => this.reservedTools.has(toolName) || this.tools.some(t => t.name === toolName),
      registerCommand: (command, def) => { this.commands.set(command, def); },
    };
    await extension(api);
    this.loaded.push(entry);
  }

  /** 从目录加载扩展文件：每个 .ts 文件默认导出一个扩展函数。Node 可以直接 import TypeScript。 */
  async loadDirectory(dir: string) {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.ts')).sort()) {
      const module = await import(pathToFileURL(join(dir, file)).href);
      await this.load(file, module.default as MoxExtension);
    }
  }

  private *handlers<K extends EventName>(event: K): Generator<[string, Handler<K>]> {
    for (const ext of this.loaded) for (const h of (ext.handlers[event] ?? []) as Handler<K>[]) yield [ext.name, h];
  }

  /** 通知类事件：一个扩展出错不影响其他扩展，也不影响 Agent 本身。 */
  async notify<K extends 'session_start' | 'agent_end' | 'session_shutdown'>(event: K, payload: EventMap[K]['event']) {
    for (const [name, handler] of this.handlers(event)) {
      try { await handler(payload, this.ctx); } catch (error) { this.errors.push({ extension: name, event, message: (error as Error).message }); }
    }
  }

  async emitInput(text: string): Promise<{ text: string; handled: boolean }> {
    let current = text;
    for (const [, handler] of this.handlers('input')) {
      const r = await handler({ text: current }, this.ctx);
      if (r?.handled) return { text: current, handled: true };
      if (r?.text !== undefined) current = r.text;
    }
    return { text: current, handled: false };
  }

  async emitBeforeAgentStart(prompt: string, systemPrompt: string): Promise<string> {
    let current = systemPrompt;
    for (const [, handler] of this.handlers('before_agent_start')) {
      const r = await handler({ prompt, systemPrompt: current }, this.ctx);
      if (r?.systemPrompt !== undefined) current = r.systemPrompt;
    }
    return current;
  }

  async emitBeforeSettle(messages: Message[]): Promise<string | undefined> {
    for (const [, handler] of this.handlers('before_settle')) {
      const r = await handler({ messages }, this.ctx);
      if (r?.followUp) return r.followUp;
    }
  }

  /**
   * 把 tool_call / tool_result 接到第 4 章工具流水线的两个钩子上。
   * 注意这里没有 try/catch：闸门类的处理函数出错，异常会被流水线变成一条错误结果，工具不执行——出错时默认拒绝。
   */
  toolHooks(): ToolHooks {
    return {
      beforeToolCall: async (call, args) => {
        for (const [, handler] of this.handlers('tool_call')) {
          const r = await handler({ toolCall: call, toolName: call.name, input: args }, this.ctx);  // args 可以被就地修改
          if (r?.block) return r;
        }
      },
      afterToolCall: async (call, args, result) => {
        let current = result;
        for (const [, handler] of this.handlers('tool_result')) {
          const patch = await handler({ toolCall: call, toolName: call.name, input: args, result: current }, this.ctx);
          if (patch) current = { ...current, ...patch };
        }
        return current === result ? undefined : current;
      },
    };
  }
}
