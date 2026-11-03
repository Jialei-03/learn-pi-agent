// 长期记忆的存储（第 10 章）。Pi 扩展和 mox 扩展共用。
// 布局：一个目录里，MEMORY.md 是索引（每条记忆一行），每条记忆一个 Markdown 文件。
// 只有索引进入系统提示；需要细节时，模型用 read 工具读具体文件——和第 11 章的 Skills 一样是“渐进式披露”。
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
  updated: string;
}

export const MEMORY_TYPES: Record<MemoryType, string> = {
  user: '用户是谁：角色、经验、偏好',
  feedback: '用户给出的工作方式要求或纠正（附上原因）',
  project: '代码里看不出来的项目背景：目标、约束、决定',
  reference: '外部资源的位置：文档、看板、工单',
};

/** 看起来像密钥的内容一律拒绝写入。记忆会跨会话长期存在，一旦泄露影响更大。 */
const SECRET_PATTERNS = [/sk-[A-Za-z0-9_-]{16,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /(password|passwd|secret|token)\s*[:=]\s*\S{6,}/i];
export const looksLikeSecret = (text: string) => SECRET_PATTERNS.some(p => p.test(text));

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'memory';

export class MemoryStore {
  readonly dir: string;
  constructor(dir: string) { this.dir = dir; }

  private file(name: string) { return join(this.dir, `${slug(name)}.md`); }

  list(): Memory[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md').map(f => this.parse(readFileSync(join(this.dir, f), 'utf8'))).filter((m): m is Memory => !!m);
  }

  private parse(text: string): Memory | undefined {
    const match = text.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
    if (!match) return undefined;
    const meta = Object.fromEntries(match[1].split('\n').map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
    return { name: meta.name, description: meta.description, type: meta.type as MemoryType, status: meta.status as MemoryStatus, source: meta.source, updated: meta.updated, content: match[2].trim() };
  }

  save(memory: Omit<Memory, 'updated'>): Memory {
    if (looksLikeSecret(`${memory.description}\n${memory.content}`)) throw new Error('拒绝保存：内容看起来包含密钥或密码。长期记忆里不能存放凭证。');
    mkdirSync(this.dir, { recursive: true });
    const full = { ...memory, updated: new Date().toISOString().slice(0, 10) };
    const front = ['name', 'description', 'type', 'status', 'source', 'updated'].map(k => `${k}: ${(full as any)[k]}`).join('\n');
    writeFileSync(this.file(memory.name), `---\n${front}\n---\n\n${memory.content.trim()}\n`);
    this.writeIndex();
    return full;
  }

  setStatus(name: string, status: MemoryStatus) {
    const m = this.list().find(x => x.name === name);
    if (!m) throw new Error(`没有名为 ${name} 的记忆`);
    this.save({ ...m, status, source: status === 'active' ? `${m.source}；用户已确认` : m.source });
  }

  forget(name: string) {
    if (!existsSync(this.file(name))) throw new Error(`没有名为 ${name} 的记忆`);
    rmSync(this.file(name));
    this.writeIndex();
  }

  /** 索引只列出已生效的记忆。待确认的不进入上下文。 */
  private writeIndex() {
    const lines = this.list().filter(m => m.status === 'active').sort((a, b) => a.name.localeCompare(b.name)).map(m => `- [${m.name}](${slug(m.name)}.md) — ${m.description}`);
    writeFileSync(join(this.dir, 'MEMORY.md'), lines.join('\n') + (lines.length ? '\n' : ''));
  }

  /** 给系统提示用的一节。限制行数：记忆越来越多时，只放最前面的若干条，避免挤占上下文。 */
  promptSection(maxLines = 100): string {
    const index = existsSync(join(this.dir, 'MEMORY.md')) ? readFileSync(join(this.dir, 'MEMORY.md'), 'utf8').trim().split('\n').filter(Boolean) : [];
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

/** 用户这次是否明确要求“记住”。只有这种情况下，模型的保存请求才直接生效。 */
export const userAskedToRemember = (prompt: string) => /记住|记下|以后(都|每次|别|不要)|remember|from now on/i.test(prompt);
