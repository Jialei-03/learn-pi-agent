// 会话（第 7 章）：把对话存成一棵树，写进一个只追加的 JSONL 文件。
// 每条记录有 id 和 parentId；“叶子”指向当前分支的末端。回到过去的某一点继续对话，
// 只是把叶子移过去——旧分支原封不动地留在文件里。重新打开文件时，最后一条记录就是叶子。
// 对照 Pi：packages/coding-agent/src/core/session-manager.ts
import { randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Message } from './types.ts';

export interface SessionHeader { type: 'session'; version: 1; id: string; cwd: string; timestamp: string }

interface EntryBase { id: string; parentId: string | null; timestamp: string }
export type Entry =
  | (EntryBase & { type: 'message'; message: Message })
  | (EntryBase & { type: 'compaction'; summary: string; firstKeptId: string; tokensBefore: number })   // 第 8 章
  | (EntryBase & { type: 'label'; targetId: string; label: string });
/** 追加时由会话自己补上 id、parentId 和时间戳。 */
type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, 'id' | 'parentId' | 'timestamp'> : never) : never;

/** 会话目录：按工作目录分组，方便“继续最近一次会话”。 */
export function sessionDirFor(cwd: string, root = join(homedir(), '.mox', 'sessions')) {
  return join(root, cwd.replace(/^\//, '').replace(/[\\/:]/g, '-') || 'root');
}

export class Session {
  readonly header: SessionHeader;
  readonly file: string | undefined;
  private entries: Entry[] = [];
  private byId = new Map<string, Entry>();
  private leaf: string | null = null;
  private flushed = false;

  private constructor(file: string | undefined, header: SessionHeader) {
    this.file = file;
    this.header = header;
  }

  /** 新建会话。文件要等到出现第一条真正的对话才创建，避免留下一堆空会话。 */
  static create(cwd: string, dir: string | undefined = sessionDirFor(cwd)): Session {
    const header: SessionHeader = { type: 'session', version: 1, id: randomUUID().slice(0, 8), cwd, timestamp: new Date().toISOString() };
    const file = dir ? join(dir, `${header.timestamp.replace(/[:.]/g, '-')}_${header.id}.jsonl`) : undefined;
    return new Session(file, header);
  }

  static open(file: string): Session {
    const lines = readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
    const parsed: unknown[] = [];
    for (const line of lines) {
      try { parsed.push(JSON.parse(line)); } catch { /* 进程崩溃时最后一行可能只写了一半：跳过 */ }
    }
    const header = parsed.find((e): e is SessionHeader => (e as SessionHeader).type === 'session');
    if (!header) throw new Error(`${file} 不是 mox 会话文件`);
    const session = new Session(file, header);
    for (const entry of parsed) {
      if ((entry as Entry).id && (entry as SessionHeader).type !== 'session') session.index(entry as Entry);
    }
    session.flushed = true;
    return session;
  }

  /** 当前目录最近一次的会话。 */
  static continueRecent(cwd: string, dir = sessionDirFor(cwd)): Session {
    const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f)) : [];
    const latest = files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    return latest ? Session.open(latest) : Session.create(cwd, dir);
  }

  private index(entry: Entry) {
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leaf = entry.id;                                    // 文件里的最后一条就是叶子
  }

  private persist(entry: Entry) {
    if (!this.file) return;
    if (!this.flushed) {
      if (!this.entries.some(e => e.type === 'message')) return;
      mkdirSync(join(this.file, '..'), { recursive: true });
      const fd = openSync(this.file, 'wx');                  // wx：文件已存在就失败，绝不覆盖别人的会话
      try { for (const e of [this.header, ...this.entries]) writeFileSync(fd, JSON.stringify(e) + '\n'); } finally { closeSync(fd); }
      this.flushed = true;
    } else {
      appendFileSync(this.file, JSON.stringify(entry) + '\n');
    }
  }

  private append(entry: NewEntry): string {
    const full = { ...entry, id: this.newId(), parentId: this.leaf, timestamp: new Date().toISOString() } as Entry;
    const previousLeaf = this.leaf;
    this.index(full);
    try {
      this.persist(full);
    } catch (error) {
      // 写盘失败：内存也要回滚，否则后面的记录会指向一个文件里不存在的父节点
      this.entries.pop();
      this.byId.delete(full.id);
      this.leaf = previousLeaf;
      throw error;
    }
    return full.id;
  }

  private newId(): string {
    for (;;) { const id = randomUUID().slice(0, 8); if (!this.byId.has(id)) return id; }
  }

  appendMessage(message: Message): string { return this.append({ type: 'message', message }); }
  appendCompaction(summary: string, firstKeptId: string, tokensBefore: number): string { return this.append({ type: 'compaction', summary, firstKeptId, tokensBefore }); }
  label(targetId: string, label: string): string { return this.append({ type: 'label', targetId, label }); }

  get leafId() { return this.leaf; }
  get(id: string) { return this.byId.get(id); }
  all(): readonly Entry[] { return this.entries; }

  /** 把叶子移到某条记录：之后追加的内容会成为它的新孩子，也就是开出一个新分支。 */
  branch(fromId: string | null) {
    if (fromId !== null && !this.byId.has(fromId)) throw new Error(`找不到记录 ${fromId}`);
    this.leaf = fromId;
  }

  /** 从根到叶子的路径：这就是“当前分支”。 */
  path(leafId: string | null = this.leaf): Entry[] {
    const out: Entry[] = [];
    for (let e = leafId ? this.byId.get(leafId) : undefined; e; e = e.parentId ? this.byId.get(e.parentId) : undefined) out.push(e);
    return out.reverse();
  }

  /**
   * 当前分支发给模型的消息。如果路径上有压缩记录（第 8 章），
   * 就用“摘要 + 从 firstKeptId 开始保留的消息 + 压缩之后的消息”代替完整历史。
   */
  messages(leafId: string | null = this.leaf): Message[] {
    const path = this.path(leafId);
    const lastCompaction = path.findLastIndex(e => e.type === 'compaction');
    if (lastCompaction === -1) return path.flatMap(e => (e.type === 'message' ? [e.message] : []));
    const compaction = path[lastCompaction] as Extract<Entry, { type: 'compaction' }>;
    const keptStart = path.findIndex(e => e.id === compaction.firstKeptId);
    const kept = path.slice(keptStart === -1 ? lastCompaction : keptStart, lastCompaction).concat(path.slice(lastCompaction + 1));
    const summary: Message = { role: 'user', content: `<summary>\n之前的对话已被压缩，以下是摘要：\n\n${compaction.summary}\n</summary>` };
    return [summary, ...kept.flatMap(e => (e.type === 'message' ? [e.message] : []))];
  }

  /** 每条记录有几个孩子：大于 1 的地方就是分叉点。 */
  children(id: string | null): Entry[] {
    return this.entries.filter(e => e.parentId === id);
  }
}
