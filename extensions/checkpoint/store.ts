// 检查点（第 16 章）：用一个“影子” git 仓库给工作目录拍快照。
// 影子仓库的 .git 放在别处（不碰项目自己的 .git），但工作目录就是项目目录，所以项目的 .gitignore 照样生效。
// 和 git stash create 相比：新建的、还没被 git 跟踪的文件也在快照里；bash 改的文件同样能恢复。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FileChange { status: 'A' | 'M' | 'D'; path: string }

export class CheckpointStore {
  readonly cwd: string;
  readonly gitDir: string;

  constructor(cwd: string, gitDir: string) { this.cwd = cwd; this.gitDir = gitDir; }

  private git(args: string[]): string {
    const r = spawnSync('git', [
      '--git-dir', this.gitDir, '--work-tree', this.cwd,
      // 影子仓库不运行任何钩子，也不受用户全局配置影响
      '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=checkpoint', '-c', 'user.email=checkpoint@localhost', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
      ...args,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`git ${args[0]} 失败：${r.stderr.trim()}`);
    return r.stdout.trim();
  }

  /** 给当前工作目录拍一张快照，返回 commit。没有变化也会生成一个（--allow-empty），这样每个检查点都有自己的 id。 */
  snapshot(message: string): string {
    if (!existsSync(this.gitDir)) {
      mkdirSync(this.gitDir, { recursive: true });
      this.git(['init', '-q']);
      // 项目没写进 .gitignore 的大目录也不该进快照
      writeFileSync(join(this.gitDir, 'info', 'exclude'), ['node_modules/', '.venv/', '__pycache__/', '.DS_Store'].join('\n') + '\n');
    }
    this.git(['add', '-A', '.']);
    this.git(['commit', '-q', '--allow-empty', '--no-verify', '-m', message]);
    return this.git(['rev-parse', 'HEAD']);
  }

  /** 两个快照之间改了哪些文件 */
  changes(from: string, to: string): FileChange[] {
    const out = this.git(['diff', '--name-status', '--no-renames', from, to]);
    return out ? out.split('\n').map(line => { const [status, path] = line.split('\t'); return { status: status as FileChange['status'], path }; }) : [];
  }

  /**
   * 把工作目录恢复到某个快照。先给当前状态再拍一张（恢复本身也可以撤销），
   * 然后 read-tree -u --reset：快照里有的文件写回去，当前有、快照里没有的文件删掉；被 .gitignore 忽略的文件不动。
   */
  restore(commit: string): { backup: string; changes: FileChange[] } {
    const backup = this.snapshot(`恢复到 ${commit.slice(0, 8)} 之前的状态`);
    const changes = this.changes(backup, commit);
    this.git(['read-tree', '-u', '--reset', commit]);
    return { backup, changes };
  }
}
