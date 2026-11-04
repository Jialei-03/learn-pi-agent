// 第 19 章实验的公共部分：启动一个 RPC 服务端（真实的 Pi，或 mox），并提供一条只做“分帧”的连接。
// 两个服务端都用脚本模型，不需要 API Key：
//   mox：MOX_API=scripted MOX_SCRIPT=labs/ch19/script.ts
//   Pi ：命令行没有“用脚本当模型”的开关，所以用扩展 labs/ch19/faux-ext.ts 注册一个脚本模型提供方
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = fileURLToPath(new URL('../..', import.meta.url));
export type Which = 'pi' | 'mox';
export const label = (which: Which) => (which === 'pi' ? '真实 Pi' : 'mox');

/** 启动参数：toolSeconds 是脚本里 bash 要跑多久，用来制造“运行中”的时间窗口 */
export function serverConfig(which: Which, toolSeconds = '0.6') {
  const env = {
    // HOME 指向临时目录：不读你本机的 ~/.pi、~/.mox 和 ~/.agents
    HOME: mkdtempSync(join(tmpdir(), 'ch19-home-')),
    PI_OFFLINE: '1',
    CH19_TOOL_SECONDS: toolSeconds,
    MOX_API: 'scripted',
    MOX_SCRIPT: join(repo, 'labs/ch19/script.ts'),
    FORCE_COLOR: '0',
  };
  const cwd = mkdtempSync(join(tmpdir(), 'ch19-cwd-'));
  return which === 'pi'
    ? { cliPath: join(repo, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), args: ['--no-session', '--offline', '-e', join(repo, 'labs/ch19/faux-ext.ts'), '--provider', 'faux', '--model', 'faux-1'], env, cwd }
    : { cliPath: join(repo, 'mox/src/cli.ts'), args: ['--no-session'], env, cwd };
}

/** 一条到 RPC 服务端的连接：按字节里的 \n 切分 stdout，把每条记录原样存下来。不做任何配对，配对是实验要观察的事。 */
export class Link {
  readonly child: ChildProcess;
  /** 按时间顺序的全部记录：→ 是客户端写的命令，← 是服务端写的响应或事件 */
  readonly log: { dir: '→' | '←'; rec: any }[] = [];
  /** stderr 上的文字：给人看的，不是协议 */
  stderr = '';
  private waiters: { test: (rec: any) => boolean; resolve: (rec: any) => void }[] = [];

  constructor(which: Which, toolSeconds?: string) {
    const config = serverConfig(which, toolSeconds);
    this.child = spawn(process.execPath, [config.cliPath, '--mode', 'rpc', ...config.args], { cwd: config.cwd, env: { ...process.env, ...config.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr!.on('data', (chunk: Buffer) => { this.stderr += chunk.toString('utf8'); });
    let buffer = Buffer.alloc(0);
    this.child.stdout!.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      let i: number;
      while ((i = buffer.indexOf(0x0a)) >= 0) {
        const rec = JSON.parse(buffer.subarray(0, i).toString('utf8'));
        buffer = buffer.subarray(i + 1);
        this.log.push({ dir: '←', rec });
        for (const w of [...this.waiters]) if (w.test(rec)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(rec); }
      }
    });
  }

  send(cmd: object | string) {
    const line = typeof cmd === 'string' ? cmd : JSON.stringify(cmd);
    this.log.push({ dir: '→', rec: typeof cmd === 'string' ? { raw: cmd } : cmd });
    this.child.stdin!.write(`${line}\n`);
  }

  /** 等一条满足条件的记录。默认只看调用之后到达的；给出 from（已收到记录的序号）则连那之后已经到达的一起看 */
  until(test: (rec: any) => boolean, from?: number, ms = 20_000): Promise<any> {
    const early = from === undefined ? undefined : this.received.slice(from).find(test);
    if (early) return Promise.resolve(early);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待超时。目前收到：${this.received.map(r => r.type).join(' ')}`)), ms);
      this.waiters.push({ test, resolve: rec => { clearTimeout(timer); resolve(rec); } });
    });
  }

  /** 关闭 stdin = 请求退出，等进程结束 */
  async close() {
    const closed = new Promise<number | null>(resolve => this.child.once('close', resolve));
    this.child.stdin!.end();
    return closed;
  }

  /** 服务端写出的记录 */
  get received() { return this.log.filter(l => l.dir === '←').map(l => l.rec); }
}

/** 一条记录是不是“响应”：线上的响应都有 type: "response"，事件没有 */
export const isResponse = (rec: any) => rec.type === 'response';
