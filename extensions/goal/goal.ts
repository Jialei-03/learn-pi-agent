// 目标循环（第 18 章）：“做完才停”。模型说“完成了”不算，一条检查命令成功（退出码 0）才算。
// 每次 Agent 准备停下时运行检查：通过就结束；不通过就把检查的输出交给模型，再来一轮。
// 两道刹车：最多几轮；上一轮什么文件都没改（原地打转）就停。这个思路社区里常被叫作 “Ralph loop”。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 把 `"npm test" 修好测试` 拆成 ['npm test', '修好测试']：引号里的算一个词 */
export const parseArgs = (text: string) => [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]);

export interface Goal { objective: string; check: string; maxRounds: number; round: number; fingerprint?: string }
export type Step = { kind: 'done' } | { kind: 'continue'; message: string } | { kind: 'stop'; reason: string };

export function runCheck(check: string, cwd: string, timeoutMs = 120_000): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    const child = spawn('/bin/bash', ['-c', check], { cwd, detached: true });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} output += '\n（检查超时）'; }, timeoutMs);
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, output }); });
  });
}

/** 工作目录的“指纹”：每个文件的路径、大小、修改时间。两轮之间指纹不变，说明模型什么都没改 */
export function fingerprint(cwd: string): string {
  const hash = createHash('sha1');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.git' || name === 'node_modules') continue;
      const path = join(dir, name);
      const st = statSync(path);
      if (st.isDirectory()) walk(path); else hash.update(`${path}:${st.size}:${st.mtimeMs}\n`);
    }
  };
  walk(cwd);
  return hash.digest('hex');
}

export async function evaluate(goal: Goal, cwd: string): Promise<Step> {
  const result = await runCheck(goal.check, cwd);
  if (result.ok) return { kind: 'done' };
  goal.round++;
  const fp = fingerprint(cwd);
  if (goal.round > goal.maxRounds) return { kind: 'stop', reason: `已经尝试了 ${goal.maxRounds} 轮，检查仍然没有通过` };
  if (goal.fingerprint === fp) return { kind: 'stop', reason: '上一轮没有修改任何文件，检查也还是失败：再继续只是在原地打转，需要人来看看' };
  goal.fingerprint = fp;
  const tail = result.output.trim().split('\n').slice(-15).join('\n');
  return {
    kind: 'continue',
    message: `目标还没有达成（第 ${goal.round}/${goal.maxRounds} 轮）。\n目标：${goal.objective}\n检查命令 \`${goal.check}\` 失败了，输出的最后部分：\n${tail}\n请继续工作，直到检查通过。只说“完成了”不算数。`,
  };
}
