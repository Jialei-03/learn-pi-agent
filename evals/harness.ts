// mox 的评测框架（第 20 章）：同一组任务，在不同的“变体”（系统提示、模型……）下反复运行，按结果打分、对比。
// 被测对象是真正的 mox 命令行：每次运行 `mox -p "任务" --yolo`，在一个全新的临时目录里，用一个全新的临时 HOME。
// 任务之间、变体之间、重复之间互不影响（对照 Pi：packages/evals，每次运行一个新容器）。
// 变体怎么改变 mox：模型用 MOX_MODEL；系统提示用 ~/.mox/AGENTS.md（mox 会把它放进每一次请求的系统提示里）。
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimateTokens } from '../mox/src/compact.ts';
import type { Msg } from '../mox/src/model.ts';

import { MOX_DIR } from '../labs/shared/mox-dir.ts';

// 被评测的 mox：默认是课程自带的参考实现；设置 MOX_DIR 就评测你自己的那份
const CLI = join(MOX_DIR, 'src', 'cli.ts');

export interface RunResult {
  finalText: string;
  /** 这次运行的完整对话：从 mox 写下的会话文件里读出来 */
  messages: Msg[];
  turns: number;
  toolCalls: number;
  /** 估算的输入 token（累计）：每次请求都会把前面的全部消息再发一遍，所以把每一轮的历史长度加起来 */
  input: number;
  ms: number;
  error?: string;
}
export interface Grade { pass: boolean; note: string }

export interface EvalCase {
  id: string;
  prompt: string;
  /** 在空目录里布置任务现场（目录已经 git init，布置完会提交一次，方便评分时看改了什么） */
  setup(dir: string): void;
  /** 确定性的评分：看最终状态（文件、测试结果），而不是看模型说了什么 */
  grade(dir: string, run: RunResult): Grade | Promise<Grade>;
}

/** 变体：模型和系统提示。notes 会写进 ~/.mox/AGENTS.md，等于给系统提示加一段话 */
export interface Variant { name: string; model?: string; notes?: string }
/** 模型服务。不传就用环境变量 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL，和平时用 mox 一样 */
export interface Backend { baseUrl?: string; apiKey?: string; model?: string }

export interface Observation { case: string; variant: string; run: number; pass: boolean; note: string; turns: number; toolCalls: number; input: number; ms: number; error?: string; /** 因为运行出错重跑了几次 */ retries?: number }

/** 读 mox 写下的会话文件（JSONL）。压缩记录的处理和 session.ts 一样 */
function readSession(home: string): Msg[] {
  const root = join(home, '.mox', 'sessions');
  if (!existsSync(root)) return [];
  const messages: Msg[] = [];
  for (const dir of readdirSync(root)) for (const file of readdirSync(join(root, dir)).filter(f => f.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(root, dir, file), 'utf8').split('\n').filter(Boolean)) {
      const record = JSON.parse(line);
      if (record.type === 'compact') messages.splice(0, messages.length - record.keep, record.summary);
      else messages.push(record.message);
    }
  }
  return messages;
}

export async function runOnce(c: EvalCase, variant: Variant, backend: Backend = {}, options: { timeoutMs?: number } = {}): Promise<{ result: RunResult; grade: Grade }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `eval-${c.id}-`)));   // realpath：macOS 的 /var 是 /private/var 的链接，会话目录按真实路径命名
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'eval-home-')));
  try {
    execSync('git init -q', { cwd: dir });
    c.setup(dir);
    execSync('git add -A && git -c user.email=eval@local -c user.name=eval commit -qm setup --allow-empty', { cwd: dir });
    if (variant.notes) { mkdirSync(join(home, '.mox')); writeFileSync(join(home, '.mox', 'AGENTS.md'), `${variant.notes}\n`); }

    const env = { ...process.env, HOME: home, NO_COLOR: '1' } as Record<string, string | undefined>;
    if (backend.baseUrl) env.MOX_BASE_URL = backend.baseUrl;
    if (backend.apiKey) env.MOX_API_KEY = backend.apiKey;
    env.MOX_MODEL = variant.model ?? backend.model ?? process.env.MOX_MODEL;
    const start = Date.now();
    const child = spawn(process.execPath, [CLI, '-p', c.prompt, '--yolo'], { cwd: dir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false;
    child.stdout.on('data', d => (output += d));
    child.stderr.on('data', d => (output += d));
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, options.timeoutMs ?? 180_000);
    const code = await new Promise<number | null>(resolve => child.on('close', resolve));
    clearTimeout(timer);

    const messages = readSession(home);
    const assistants = messages.flatMap((m, i) => (m.role === 'assistant' ? [{ m, i }] : []));
    const last = assistants.at(-1)?.m;
    const result: RunResult = {
      finalText: last?.role === 'assistant' ? last.content ?? '' : '',
      messages,
      turns: assistants.length,
      toolCalls: assistants.reduce((n, { m }) => n + (m.role === 'assistant' ? m.tool_calls?.length ?? 0 : 0), 0),
      input: assistants.reduce((n, { i }) => n + estimateTokens(messages.slice(0, i)), 0),
      ms: Date.now() - start,
      // 退出码非 0：mox 的运行抛了异常（网络中断、服务报错）；超时是我们杀的
      ...(timedOut ? { error: '超时' } : code !== 0 ? { error: output.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').at(-1) ?? `退出码 ${code}` } : {}),
    };
    // 运行出错（网络、超时）不是“任务失败”，而是这次观测无效——报告里要单独统计，不能混进通过率
    const grade = result.error ? { pass: false, note: `运行出错：${result.error}` } : await c.grade(dir, result);
    return { result, grade };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * 每个任务 × 每轮 × 每个变体都跑一次。奇数轮先 A 后 B，偶数轮反过来，减少顺序带来的偏差（Pi 的 evals 也这样做）。
 * 同一个任务同一轮的几个变体按顺序跑（它们要配成一对），不同的（任务，轮）之间可以并发。
 */
export async function runEval(
  cases: EvalCase[], variants: Variant[], backend: Backend, runs: number,
  { concurrency = 1, retries = 0, onObservation = () => {}, onRun = () => {} }: { concurrency?: number; retries?: number; onObservation?: (o: Observation) => void; onRun?: (o: Observation, result: RunResult) => void } = {},
) {
  const observations: Observation[] = [];
  const units = cases.flatMap(c => Array.from({ length: runs }, (_, i) => ({ c, run: i + 1 })));
  let next = 0;
  const worker = async () => {
    while (next < units.length) {
      const { c, run } = units[next++];
      const order = run % 2 === 1 ? variants : [...variants].reverse();
      for (const v of order) {
        // 运行出错（比如 429 限流）是这次观测无效，不是任务失败：等一会儿，重跑一次全新的运行，最多 retries 次
        let attempt = 0;
        let { result, grade } = await runOnce(c, v, backend);
        while (result.error && attempt < retries) {
          attempt++;
          await new Promise(r => setTimeout(r, 15_000 * attempt));
          ({ result, grade } = await runOnce(c, v, backend));
        }
        const o: Observation = { case: c.id, variant: v.name, run, pass: grade.pass, note: grade.note, turns: result.turns, toolCalls: result.toolCalls, input: result.input, ms: result.ms, error: result.error, ...(attempt ? { retries: attempt } : {}) };
        observations.push(o);
        onObservation(o);
        onRun(o, result);                // 想保存轨迹（比如失败的运行）的调用者在这里拿到完整的消息
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, units.length) }, worker));
  return observations;
}

/** Wilson 区间：小样本时比“通过数 / 总数 ± 1.96σ”可靠得多 */
export function wilson(pass: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = pass / n;
  const center = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** 成对比较的符号检验：只看结果不同的那些对（只有 A 通过 a 对，只有 B 通过 b 对），如果两个变体其实一样好，这样悬殊的概率有多大（双侧，精确） */
export function signTest(a: number, b: number): number {
  const n = a + b;
  if (n === 0) return 1;
  const choose = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  let tail = 0;
  for (let k = 0; k <= Math.min(a, b); k++) tail += choose(n, k);
  return Math.min(1, (2 * tail) / 2 ** n);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function report(observations: Observation[], variants: string[]): string {
  const valid = observations.filter(o => !o.error);
  const lines: string[] = [];
  const errors = observations.length - valid.length;
  const retried = observations.reduce((n, o) => n + (o.retries ?? 0), 0);
  lines.push(`有效观测 ${valid.length} 次${errors ? `（另有 ${errors} 次运行出错，不计入通过率）` : ''}${retried ? `；其中有 ${retried} 次是运行出错（限流等）之后重跑的` : ''}\n`);
  lines.push(`| 变体 | 通过率 | 95% 区间 | 平均轮数 | 估算输入 token | 平均耗时 |`);
  lines.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const v of variants) {
    const os = valid.filter(o => o.variant === v);
    const pass = os.filter(o => o.pass).length;
    const [lo, hi] = wilson(pass, os.length);
    const avg = (f: (o: Observation) => number) => (os.length ? os.reduce((n, o) => n + f(o), 0) / os.length : 0);
    lines.push(`| ${v} | ${pass}/${os.length}（${pct(pass / Math.max(1, os.length))}） | ${pct(lo)}–${pct(hi)} | ${avg(o => o.turns).toFixed(1)} | ${Math.round(avg(o => o.input))} | ${(avg(o => o.ms) / 1000).toFixed(1)}s |`);
  }
  lines.push('');
  const cases = [...new Set(observations.map(o => o.case))];
  lines.push(`| 任务 | ${variants.join(' | ')} |`);
  lines.push(`| --- | ${variants.map(() => '---').join(' | ')} |`);
  for (const c of cases) {
    const cell = (v: string) => valid.filter(o => o.case === c && o.variant === v).sort((a, b) => a.run - b.run).map(o => (o.pass ? '✓' : '✗')).join('') || '—';
    lines.push(`| ${c} | ${variants.map(cell).join(' | ')} |`);
  }
  // 成对比较：同一个任务、同一轮，两个变体都有有效结果才算一对
  if (variants.length === 2) {
    const [a, b] = variants;
    let onlyA = 0, onlyB = 0, pairs = 0;
    for (const o of valid.filter(x => x.variant === a)) {
      const other = valid.find(x => x.variant === b && x.case === o.case && x.run === o.run);
      if (!other) continue;
      pairs++;
      if (o.pass && !other.pass) onlyA++;
      if (!o.pass && other.pass) onlyB++;
    }
    lines.push(`\n成对比较（${pairs} 对）：只有 ${a} 通过 ${onlyA} 对，只有 ${b} 通过 ${onlyB} 对，其余两者结果相同。${onlyA + onlyB ? `如果两个变体其实一样好，出现这么悬殊的对数的概率是 ${signTest(onlyA, onlyB).toFixed(2)}（符号检验）。` : ''}`);
    const flaky = cases.filter(c => variants.some(v => { const r = valid.filter(o => o.case === c && o.variant === v); return r.some(o => o.pass) && r.some(o => !o.pass); }));
    if (flaky.length) lines.push(`结果不稳定（同一变体有时通过有时失败）的任务：${flaky.join('、')}`);
  }
  return lines.join('\n');
}
