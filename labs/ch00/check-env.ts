// 第 0 章：检查环境能不能跑后面所有实验。
//   node labs/ch00/check-env.ts
// 每一项只打一行；最后一项把第 2 章的回放实验跑一遍，只看结论。
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

const replay = execFileSync(process.execPath, ['labs/ch02/replay.ts'], { encoding: 'utf8' });
const same = /是否一致.*：是/.test(replay);
checks.push(['mox 和 Pi 读同一段回放', same, same ? '四个实现结果一致' : '结果不一致，见 node labs/ch02/replay.ts']);

for (const [label, ok, detail] of checks) console.log(`${ok ? '✓' : '✗'} ${label}：${detail}`);

// 可选项：旁边的 Pi 源码，读代码时对照用，没有也不影响实验
const source = existsSync('../pi-v1.5.0/package.json');
console.log(`${source ? '✓' : '·'} Pi 源码 ../pi-v1.5.0：${source ? '已克隆' : '没有克隆（可选）'}`);

const failed = checks.filter(([, ok]) => !ok).length;
console.log(failed ? `\n有 ${failed} 项没通过，先按提示修好。` : '\n环境就绪。');
process.exitCode = failed ? 1 : 0;
