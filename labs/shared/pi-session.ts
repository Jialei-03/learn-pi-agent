// 用 Pi 真实的 AgentSession（带扩展系统）跑实验：模型换成 faux 脚本模型，不需要 API Key。
// 第 9 章起的扩展实验都用它。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { registerFauxProvider } from '@earendil-works/pi-ai/compat';

export interface PiSessionOptions {
  /** 内联扩展：和写在 ~/.pi/agent/extensions/*.ts 里的扩展完全一样，只是直接传函数 */
  extensions?: ((pi: any) => void | Promise<void>)[];
  /** 脚本模型的回复：消息对象，或根据上下文生成消息的函数 */
  responses: any[];
  cwd?: string;
  settings?: Record<string, unknown>;
  /** 额外的 Skill 目录、提示模板目录（第 11 章） */
  skillPaths?: string[];
  promptTemplatePaths?: string[];
  sessionManager?: SessionManager;
  /** 脚本化的界面（第 14 章起）：只需实现用到的方法，比如 select、confirm、notify。不提供则相当于没有界面（ctx.hasUI 为假） */
  ui?: Record<string, (...args: any[]) => any>;
  /** 传给脚本模型提供方的选项，比如 { tokenSize: { min: 4, max: 4 } } 让每个增量的长度固定（第 19 章） */
  faux?: Record<string, unknown>;
}

export async function createPiSession(options: PiSessionOptions) {
  const cwd = options.cwd ?? mkdtempSync(join(tmpdir(), 'pi-lab-'));
  const agentDir = join(cwd, '.pi-agent');                       // 隔离的配置目录，不碰你本机的 ~/.pi
  const faux = registerFauxProvider(options.faux ?? {});
  faux.setResponses(options.responses);
  const model = faux.getModel();
  const modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false } as any);
  modelRuntime.registerProvider(model.provider, {
    baseUrl: model.baseUrl, apiKey: 'faux-key', api: faux.api,
    models: faux.models.map((m: any) => ({ id: m.id, name: m.name, api: m.api, reasoning: m.reasoning, input: m.input, cost: m.cost, contextWindow: m.contextWindow, maxTokens: m.maxTokens, baseUrl: m.baseUrl })),
  } as any);
  // 只加载实验自己的 Skills：不能让本机 ~/.agents/skills 里的个人 Skill 混进来，否则结果因机器而异
  const ownSkill = (path: string) => (options.skillPaths ?? []).some(dir => path.startsWith(dir));
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, extensionFactories: options.extensions ?? [],
    additionalSkillPaths: options.skillPaths, additionalPromptTemplatePaths: options.promptTemplatePaths,
    skillsOverride: base => ({ ...base, skills: base.skills.filter(s => ownSkill(s.filePath)), diagnostics: base.diagnostics.filter((d: any) => ownSkill(d.path ?? '')) }),
  } as any);
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd, agentDir, model, modelRuntime, resourceLoader,
    sessionManager: options.sessionManager ?? SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory(options.settings as any),
  });
  // 没实现的界面方法一律当作空操作
  const uiContext = options.ui ? new Proxy(options.ui, { get: (target, key: string) => target[key] ?? (() => undefined) }) : undefined;
  // 命令可以导航会话树（第 16 章的 /rewind 要用）；其余会话操作在实验里用不到
  const commandContextActions = {
    waitForIdle: async () => {}, reload: async () => {},
    newSession: async () => ({ cancelled: true }), fork: async () => ({ cancelled: true }), switchSession: async () => ({ cancelled: true }),
    navigateTree: (targetId: string, opts?: any) => session.navigateTree(targetId, opts),
  };
  await session.bindExtensions({ ...(uiContext ? { uiContext: uiContext as any } : {}), commandContextActions: commandContextActions as any });
  return { session, faux, cwd };
}

export const textOf = (m: any) => (typeof m.content === 'string' ? m.content : m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));
