// 长期记忆的存储和写入规则（第 10 章）。Pi 扩展和 mox 扩展共用这一个文件。
//
// 磁盘布局：一个目录，MEMORY.md 是索引（每条记忆一行），每条记忆一个带元信息的 Markdown 文件。
// 只有索引进入系统提示；需要细节时，模型用 read 工具读具体文件——和第 11 章的 Skills 一样是“渐进式披露”。
//
// 写入规则（谁能让一条记忆生效、被覆盖、被删除）集中在文件末尾的 saveFromModel / forgetFromModel：
// 两个扩展只负责回答“用户这次说了什么”“弹窗里点了什么”，规则本身只有一份。
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';
export type MemoryStatus = 'active' | 'pending';

export interface Memory {
  name: string;          // 短横线连接的标识，也是文件名
  description: string;   // 一行摘要：进入索引，用来判断“这条记忆现在相关吗”
  type: MemoryType;
  content: string;
  status: MemoryStatus;  // pending：模型自己决定记的，等用户确认后才生效
  source: string;        // 来源说明，方便事后审查
  updated: string;       // 最后写入的日期（YYYY-MM-DD）。引用记忆时，模型可以据此判断它有多旧
}

export type SaveParams = Pick<Memory, 'name' | 'description' | 'type' | 'content'>;

export const MEMORY_TYPES: Record<MemoryType, string> = {
  user: '用户是谁：角色、经验、偏好',
  feedback: '用户给出的工作方式要求或纠正（附上原因）',
  project: '代码里看不出来的项目背景：目标、约束、决定',
  reference: '外部资源的位置：文档、看板、工单',
};

/** 看起来像密钥的内容一律拒绝写入。记忆会跨会话长期存在，一旦泄露影响更大。 */
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/,                         // OpenAI 风格的 API Key
  /gh[pousr]_[A-Za-z0-9]{20,}/,                    // GitHub token
  /AKIA[0-9A-Z]{16}/,                              // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,            // PEM 私钥
  /(password|passwd|secret|token)\s*[:=]\s*\S{6,}/i, // “password: xxx” 这种键值对
];
export const looksLikeSecret = (text: string) => SECRET_PATTERNS.some(pattern => pattern.test(text));

/** 项目目录 → 记忆目录名：/Users/me/app → Users-me-app。同一个项目总是落在同一个目录里。 */
export const projectSlug = (cwd: string) => cwd.replace(/^\//, '').replace(/[\\/:]/g, '-') || 'root';

/** 记忆名 → 文件名。只留小写字母、数字和汉字，所以 `../../x` 这样的名字没法跳出记忆目录。 */
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'memory';

const FRONT_MATTER_KEYS = ['name', 'description', 'type', 'status', 'source', 'updated'] as const;

export class MemoryStore {
  readonly dir: string;
  constructor(dir: string) { this.dir = dir; }

  private file(name: string) { return join(this.dir, `${slug(name)}.md`); }

  /** 所有记忆（包括待确认的），不含 MEMORY.md 索引本身。 */
  list(): Memory[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter(file => file.endsWith('.md') && file !== 'MEMORY.md')
      .map(file => this.parse(readFileSync(join(this.dir, file), 'utf8')))
      .filter((memory): memory is Memory => !!memory);
  }

  get(name: string): Memory | undefined {
    return this.list().find(memory => memory.name === name);
  }

  /** 文件格式：--- 之间是 `key: value` 的元信息，空行之后是正文。 */
  private parse(text: string): Memory | undefined {
    const match = text.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
    if (!match) return undefined;
    const meta = Object.fromEntries(match[1].split('\n').map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
    return {
      name: meta.name, description: meta.description, type: meta.type as MemoryType,
      status: meta.status as MemoryStatus, source: meta.source, updated: meta.updated,
      content: match[2].trim(),
    };
  }

  /** 写入一条记忆（同名则覆盖），并重写索引。密钥在这里被拦下，所以不管谁调用都绕不过。 */
  save(memory: Omit<Memory, 'updated'>): Memory {
    if (looksLikeSecret(`${memory.description}\n${memory.content}`)) {
      throw new Error('拒绝保存：内容看起来包含密钥或密码。长期记忆里不能存放凭证。');
    }
    mkdirSync(this.dir, { recursive: true });
    const full: Memory = { ...memory, updated: new Date().toISOString().slice(0, 10) };
    const front = FRONT_MATTER_KEYS.map(key => `${key}: ${full[key]}`).join('\n');
    writeFileSync(this.file(memory.name), `---\n${front}\n---\n\n${memory.content.trim()}\n`);
    this.writeIndex();
    return full;
  }

  /** 用户确认一条待确认的记忆（/memory approve）。 */
  setStatus(name: string, status: MemoryStatus) {
    const memory = this.get(name);
    if (!memory) throw new Error(`没有名为 ${name} 的记忆`);
    const confirmedNow = status === 'active' && memory.status !== 'active';   // 已经生效的不重复追加“已确认”
    this.save({ ...memory, status, source: confirmedNow ? `${memory.source}；用户已确认` : memory.source });
  }

  /** 删除一条记忆。这是不设防的底层操作；模型发起的删除要先过 forgetFromModel。 */
  forget(name: string) {
    if (!existsSync(this.file(name))) throw new Error(`没有名为 ${name} 的记忆`);
    rmSync(this.file(name));
    this.writeIndex();
  }

  /** 索引只列出已生效的记忆，按名字排序（顺序稳定，新增一条只改动一行）。待确认的不进入上下文。 */
  private writeIndex() {
    const lines = this.list()
      .filter(memory => memory.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(memory => `- [${memory.name}](${slug(memory.name)}.md) — ${memory.description}`);
    writeFileSync(join(this.dir, 'MEMORY.md'), lines.join('\n') + (lines.length ? '\n' : ''));
  }

  /** 给系统提示用的一节。限制行数：记忆越来越多时，只放最前面的若干条，避免挤占上下文。 */
  promptSection(maxLines = 100): string {
    const indexFile = join(this.dir, 'MEMORY.md');
    const index = existsSync(indexFile) ? readFileSync(indexFile, 'utf8').trim().split('\n').filter(Boolean) : [];
    const shown = index.slice(0, maxLines);
    return [
      `你有一个跨会话的长期记忆，存放在 ${this.dir}。`,
      shown.length ? `已有的记忆（每行一条；需要细节时用 read 读取对应文件）：\n${shown.join('\n')}${index.length > maxLines ? `\n（还有 ${index.length - maxLines} 条未列出）` : ''}` : '目前还没有记忆。',
      '',
      '用 save_memory 保存以后的会话仍然有用、但无法从代码和 git 历史里得到的信息：用户的偏好与纠正、项目的背景与决定、外部资源的位置。',
      '不要保存：代码结构、可以重新查到的事实、本次任务的临时状态、任何密钥。',
      '记忆可能过时：引用其中的文件、函数之前，先确认它们仍然存在。',
    ].join('\n');
  }
}

// ── 写入规则 ─────────────────────────────────────────────────────

/** 用户这次是否明确要求“记住”。只有这种情况下，模型的保存请求才直接生效。 */
export const userAskedToRemember = (prompt: string) => /记住|记下|以后(都|每次|别|不要)|remember|from now on/i.test(prompt);

/** 用户这次是否明确要求“忘掉”。 */
export const userAskedToForget = (prompt: string) => /忘记|忘掉|删除.{0,8}记忆|删掉.{0,8}记忆|forget/i.test(prompt);

/** 谁批准了这次操作：explicit 是用户在输入里直接说了，confirmed 包含 explicit，再加上用户在弹窗里点了确认。 */
export interface Approval { explicit: boolean; confirmed: boolean }

// #region saveFromModel
/**
 * 模型调用 save_memory 时走这里。
 *  - 用户批准了（说了“记住”或点了确认）：立即生效；
 *  - 没批准：存为 pending，不进索引，等 /memory approve；
 *  - 同名的记忆已经生效、而这次没有批准：拒绝。否则一次没人批准的写入，会把用户确认过的记忆从索引里挤掉。
 */
export function saveFromModel(store: MemoryStore, params: SaveParams, approval: Approval): Memory {
  const existing = store.get(params.name);
  if (existing?.status === 'active' && !approval.confirmed) {
    throw new Error(`记忆 ${params.name} 已经生效，覆盖它需要用户确认。请把想法告诉用户，由用户决定。`);
  }
  return store.save({
    ...params,
    status: approval.confirmed ? 'active' : 'pending',
    source: approval.explicit ? '用户在对话中要求记住' : approval.confirmed ? '模型提议，用户在弹窗中确认' : '模型提议，等待用户确认',
  });
}
// #endregion

// #region forgetFromModel
/** 模型调用 forget_memory 时走这里：删除和写入一样会改变之后每个会话的行为，所以同样需要用户批准。 */
export function forgetFromModel(store: MemoryStore, name: string, approval: Approval) {
  if (!approval.confirmed) throw new Error(`删除记忆需要用户确认。请告诉用户，由用户运行 /memory forget ${name}。`);
  store.forget(name);
}
// #endregion
