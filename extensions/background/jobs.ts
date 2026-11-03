// 后台进程（第 18 章）：开发服务器、监听模式的测试、长时间的构建——这些命令不会很快结束，bash 工具却要等它结束才返回。
// 后台任务让模型启动之后继续干别的，需要时再看输出，结束时收到通知。
import { spawn, type ChildProcess } from 'node:child_process';

export interface Job {
  id: number;
  command: string;
  pid?: number;
  status: 'running' | 'exited';
  exitCode?: number | null;
  output: string;
  /** 模型已经读到哪里了：bash_output 只返回新的部分 */
  readOffset: number;
  /** 被丢弃的字节数（输出只保留最后 MAX_BUFFER 个字符） */
  dropped: number;
  startedAt: number;
}

const MAX_BUFFER = 1024 * 1024;

export class BackgroundJobs {
  readonly jobs = new Map<number, Job>();
  private processes = new Map<number, ChildProcess>();
  private nextId = 1;
  private cwd: string;
  onExit: (job: Job) => void = () => {};

  constructor(cwd: string) { this.cwd = cwd; }

  start(command: string): Job {
    const child = spawn('/bin/bash', ['-c', command], { cwd: this.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const job: Job = { id: this.nextId++, command, pid: child.pid, status: 'running', output: '', readOffset: 0, dropped: 0, startedAt: Date.now() };
    const append = (d: Buffer) => {
      job.output += d.toString();
      // 只保留最后 1MB：一个跑了一整天的开发服务器，不能把内存吃光
      if (job.output.length > MAX_BUFFER) {
        const cut = job.output.length - MAX_BUFFER;
        job.output = job.output.slice(cut);
        job.dropped += cut;
        job.readOffset = Math.max(0, job.readOffset - cut);
      }
    };
    child.stdout!.on('data', append);
    child.stderr!.on('data', append);
    child.on('close', code => {
      job.status = 'exited';
      job.exitCode = code;
      this.processes.delete(job.id);
      this.onExit(job);
    });
    this.jobs.set(job.id, job);
    this.processes.set(job.id, child);
    return job;
  }

  /** 从上次读到的位置开始的新输出 */
  read(id: number): { job: Job; text: string } | undefined {
    const job = this.jobs.get(id);
    if (!job) return;
    const text = job.output.slice(job.readOffset);
    job.readOffset = job.output.length;
    return { job, text };
  }

  /** 杀掉整个进程组（第 5 章：命令可能启动了子进程） */
  kill(id: number): boolean {
    const child = this.processes.get(id);
    if (!child?.pid) return false;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    return true;
  }

  killAll() { for (const id of this.processes.keys()) this.kill(id); }
}

export const describeJob = (job: Job) =>
  `#${job.id} ${job.status === 'running' ? `运行中（${((Date.now() - job.startedAt) / 1000).toFixed(0)} 秒）` : `已退出，退出码 ${job.exitCode}`}：${job.command}`;
