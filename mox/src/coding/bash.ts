// bash 工具（第 5 章）：执行 shell 命令。
// 三件事最要紧：超时和取消时杀掉整个进程树；输出过长时保留结尾并把完整输出存到临时文件；非零退出码算失败。
// 对照 Pi：packages/coding-agent/src/core/tools/bash.ts
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentTool } from '../tools.ts';
import { truncateTail } from './truncate.ts';

const MAX_TIMEOUT_SECONDS = 600;

/** 杀掉整个进程组。spawn 时用了 detached，子进程是新进程组的组长，-pid 指向整个组。 */
function killTree(pid: number) {
  try { process.kill(-pid, 'SIGKILL'); } catch { /* 进程已经退出 */ }
}

export function createBashTool(cwd: string): AgentTool {
  return {
    name: 'bash',
    description: '在当前工作目录执行 bash 命令，返回合并后的 stdout 和 stderr。输出最多保留最后 2000 行或 50KB，超出时完整输出会存到临时文件。可以用 timeout 指定超时秒数。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        timeout: { type: 'number', minimum: 1, maximum: MAX_TIMEOUT_SECONDS, description: '超时秒数（可选）' },
      },
      required: ['command'],
    },
    execute({ command, timeout }, { signal, onUpdate }) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('已取消'));
        const child = spawn('bash', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks: Buffer[] = [];
        let timedOut = false;
        const onData = (data: Buffer) => { chunks.push(data); onUpdate?.(Buffer.concat(chunks).toString('utf8').slice(-2000)); };
        child.stdout!.on('data', onData);
        child.stderr!.on('data', onData);
        const onAbort = () => child.pid && killTree(child.pid);
        signal?.addEventListener('abort', onAbort, { once: true });
        const timer = timeout ? setTimeout(() => { timedOut = true; onAbort(); }, timeout * 1000) : undefined;

        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', (code, sig) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          const full = Buffer.concat(chunks).toString('utf8');
          const t = truncateTail(full);
          let text = full ? t.text : '（没有输出）';
          if (t.truncated) {
            const file = join(mkdtempSync(join(tmpdir(), 'mox-bash-')), 'output.txt');
            writeFileSync(file, full);
            text += `\n\n[只显示最后 ${t.shownLines} 行，共 ${t.totalLines} 行。完整输出：${file}]`;
          }
          if (signal?.aborted) return reject(new Error(`${text}\n\n命令已取消`));
          if (timedOut) return reject(new Error(`${text}\n\n命令超时（${timeout} 秒）`));
          const exitCode = code ?? (sig ? 128 : 1);           // 被信号杀死的进程没有退出码，按 shell 惯例算失败
          if (exitCode !== 0) return resolve({ content: `${text}\n\n命令退出码 ${exitCode}`, isError: true });
          resolve({ content: text });
        });
      });
    },
  };
}
