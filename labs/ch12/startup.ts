// 第 12 章实验：服务器起不来，mox 怎么办？
//   node labs/ch12/startup.ts
// 一次 connectMcp 调用里放四个服务器：一个正常的；一个命令根本不存在；一个启动就退出；一个启动了但从不回应握手。
// 它们按顺序连接，最后一个会让握手等满 10 秒。
import assert from 'node:assert/strict';
import { connectMcp } from '../../mox/src/mcp.ts';
import { serverCommand } from './shared.ts';

const warnings: string[] = [];
const started = Date.now();
const mcp = await connectMcp({
  nonexistent: { command: 'mox-no-such-command' },
  quitter: { command: process.execPath, args: ['-e', ''] },
  silent: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] },
  issues: serverCommand,
}, message => warnings.push(message));
const seconds = Math.round((Date.now() - started) / 1000);

console.log(`connectMcp 返回，用了约 ${seconds} 秒。收到的警告：`);
warnings.forEach(w => console.log(`  ${w}`));
const byServer = Object.groupBy(mcp.tools, t => t.name.split('__')[1]);
console.log(`\n可用的工具：${Object.entries(byServer).map(([server, tools]) => `${server}（${tools!.length} 个）`).join('、')}`);
console.log('其余三个服务器：连接失败只留下一条警告，mox 照常启动，其他服务器不受影响。');
mcp.close();

assert.equal(warnings.length, 3);
assert.match(warnings[0], /nonexistent.*ENOENT/);
assert.match(warnings[1], /quitter.*已退出/);
assert.match(warnings[2], /silent.*10 秒内没有响应/);
assert.deepEqual(Object.keys(byServer), ['issues']);
assert.ok(seconds >= 10 && seconds <= 13);
