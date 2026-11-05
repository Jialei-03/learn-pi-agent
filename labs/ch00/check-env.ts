// 第 0 章：检查环境能不能跑后面所有实验。
//   node labs/ch00/check-env.ts
// 每一项只打一行；mox 能启动，并且 mox 和 Pi 读同一段回放（第 2 章的实验）得到相同的结果。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const checks: Array<[string, boolean, string]> = [];

const [major, minor] = process.versions.node.split('.').map(Number);
checks.push(['Node.js ≥ 22.19', major > 22 || (major === 22 && minor >= 19), `当前 v${process.versions.node}`]);

for (const name of ['pi-ai', 'pi-agent-core', 'pi-coding-agent']) {
  const file = `node_modules/@earendil-works/${name}/package.json`;
  const version = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).version : '未安装';
  checks.push([`Pi 包 ${name}`, version === '1.5.0', version === '未安装' ? '没找到，先运行 npm install' : `版本 ${version}`]);
}

// mox 是 Git 子模块：没克隆下来的话 mox/ 是空目录
const moxReady = existsSync('mox/src/loop.ts');
const moxHelp = moxReady ? execFileSync(process.execPath, ['mox/src/cli.ts', '--help'], { encoding: 'utf8' }) : '';
checks.push(['mox（Mox-agent 子模块）', moxHelp.includes('用法'), moxReady ? '命令行能启动' : '没找到 mox/src，先运行 git submodule update --init']);

// 第 2 章的回放实验：同一段 SSE 字节流交给 mox 的 openai() 和 Pi 的适配器
const replay = moxReady ? execFileSync(process.execPath, ['labs/ch02/replay.ts'], { encoding: 'utf8' }) : '';
const verdicts = replay.match(/是否一致：.*/g) ?? [];
const same = verdicts.length > 0 && verdicts.every(v => v.endsWith('是'));
checks.push(['mox 和 Pi 读同一段回放', same, same ? `${verdicts.length} 段样本，结果一致` : '结果不一致，见 node labs/ch02/replay.ts']);

for (const [label, ok, detail] of checks) console.log(`${ok ? '✓' : '✗'} ${label}：${detail}`);

// 可选项：旁边的 Pi 源码，读代码时对照用，没有也不影响实验
const source = existsSync('../pi-v1.5.0/package.json');
console.log(`${source ? '✓' : '·'} Pi 源码 ../pi-v1.5.0：${source ? '已克隆' : '没有克隆（可选）'}`);

const failed = checks.filter(([, ok]) => !ok).length;
console.log(failed ? `\n有 ${failed} 项没通过，先按提示修好。` : '\n环境就绪。');
process.exitCode = failed ? 1 : 0;
