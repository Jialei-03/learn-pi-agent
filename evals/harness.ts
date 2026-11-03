// mox 的评测框架（第 20 章）：同一组任务，在不同的“变体”（系统提示、工具、模型……）下反复运行，按结果打分、对比。
// 每次运行都在一个全新的临时目录里：任务之间、变体之间、重复之间互不影响（对照 Pi：packages/evals，每次运行一个新容器）。
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodingTools } from '../mox/src/coding/index.ts';
import { buildSystemPrompt } from '../mox/src/context.ts';
import { runLoop } from '../mox/src/loop.ts';
import type { AgentTool } from '../mox/src/tools.ts';
import type { Message, Model } from '../mox/src/types.ts';

export interface RunResult {
  finalText: string;
  messages: Message[];
  turns: number;
  toolCalls: number;
  input: number;
  output: number;
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

export interface Variant { name: string; systemPromptSuffix?: string; tools?: (cwd: string) => AgentTool[] }

export interface Observation { case: string; variant: string; run: number; pass: boolean; note: string; turns: number; toolCalls: number; input: number; output: number; ms: number; error?: string }

export async function runOnce(c: EvalCase, variant: Variant, model: Model, options: { maxTurns?: number; timeoutMs?: number } = {}): Promise<{ result: RunResult; grade: Grade }> {
  const dir = mkdtempSync(join(tmpdir(), `eval-${c.id}-`));
  try {
    execSync('git init -q', { cwd: dir });
    c.setup(dir);
    execSync('git add -A && git -c user.email=eval@local -c user.name=eval commit -qm setup --allow-empty', { cwd: dir });
    const tools = variant.tools?.(dir) ?? createCodingTools(dir);
    const systemPrompt = (await buildSystemPrompt({ cwd: dir, tools })) + (variant.systemPromptSuffix ? `\n\n${variant.systemPromptSuffix}` : '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 180_000);
    const start = Date.now();
    let toolCalls = 0;
    const { messages, reason } = await runLoop([], [{ role: 'user', content: c.prompt }], {
      model, systemPrompt, tools, signal: controller.signal,
      onEvent: e => { if (e.type === 'tool_start') toolCalls++; },
      finishTurn: ({ turn }) => (turn >= (options.maxTurns ?? 25) ? 'end' : undefined),
    }).finally(() => clearTimeout(timer));
    const assistants = messages.filter(m => m.role === 'assistant');
    const last = assistants.at(-1);
    const result: RunResult = {
      finalText: last?.role === 'assistant' ? last.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('') : '',
      messages, turns: assistants.length, toolCalls,
      input: assistants.reduce((n, m) => n + (m.role === 'assistant' ? m.usage.input + m.usage.cacheRead : 0), 0),
      output: assistants.reduce((n, m) => n + (m.role === 'assistant' ? m.usage.output : 0), 0),
      ms: Date.now() - start,
      ...(reason === 'error' || reason === 'aborted' ? { error: last?.role === 'assistant' ? last.errorMessage ?? reason : reason } : {}),
    };
    // 运行出错（网络、超时）不是“任务失败”，而是这次观测无效——报告里要单独统计，不能混进通过率
    const grade = result.error ? { pass: false, note: `运行出错：${result.error}` } : await c.grade(dir, result);
    return { result, grade };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 每个任务 × 每轮 × 每个变体都跑一次。奇数轮先 A 后 B，偶数轮反过来，减少顺序带来的偏差（Pi 的 evals 也这样做） */
export async function runEval(cases: EvalCase[], variants: Variant[], model: Model, runs: number, onObservation: (o: Observation) => void = () => {}, onRun: (o: Observation, result: RunResult) => void = () => {}) {
  const observations: Observation[] = [];
  for (const c of cases) {
    for (let run = 1; run <= runs; run++) {
      const order = run % 2 === 1 ? variants : [...variants].reverse();
      for (const v of order) {
        const { result, grade } = await runOnce(c, v, model);
        const o: Observation = { case: c.id, variant: v.name, run, pass: grade.pass, note: grade.note, turns: result.turns, toolCalls: result.toolCalls, input: result.input, output: result.output, ms: result.ms, error: result.error };
        observations.push(o);
        onObservation(o);
        onRun(o, result);                // 想保存轨迹（比如失败的运行）的调用者在这里拿到完整的消息
      }
    }
  }
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

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function report(observations: Observation[], variants: string[]): string {
  const valid = observations.filter(o => !o.error);
  const lines: string[] = [];
  const errors = observations.length - valid.length;
  lines.push(`有效观测 ${valid.length} 次${errors ? `（另有 ${errors} 次运行出错，不计入通过率）` : ''}\n`);
  lines.push(`| 变体 | 通过率 | 95% 区间 | 平均轮数 | 平均输入 token | 平均耗时 |`);
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
    const cell = (v: string) => valid.filter(o => o.case === c && o.variant === v).map(o => (o.pass ? '✓' : '✗')).join('') || '—';
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
    lines.push(`\n成对比较（${pairs} 对）：只有 ${a} 通过 ${onlyA} 对，只有 ${b} 通过 ${onlyB} 对，其余两者结果相同。`);
    const flaky = cases.filter(c => variants.some(v => { const r = valid.filter(o => o.case === c && o.variant === v); return r.some(o => o.pass) && r.some(o => !o.pass); }));
    if (flaky.length) lines.push(`结果不稳定（同一变体有时通过有时失败）的任务：${flaky.join('、')}`);
  }
  return lines.join('\n');
}
