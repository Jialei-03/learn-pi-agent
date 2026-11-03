// 第 18 章实验的子进程：跑一轮 mox，会在工具执行期间被父进程强行杀掉。
import { createCodingTools } from '../../mox/src/coding/index.ts';
import { runLoop } from '../../mox/src/loop.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import { Session } from '../../mox/src/session.ts';

const [cwd, dir] = process.argv.slice(2);
const session = Session.create(cwd, dir);
const model = scripted(() => ({
  toolCalls: [
    { id: 'c1', name: 'read', arguments: { path: 'README.md' } },
    { id: 'c2', name: 'bash', arguments: { command: 'echo "部署 v2" >> deploy.log' } },
    { id: 'c3', name: 'bash', arguments: { command: 'sleep 30' } },
  ],
}));
await runLoop([], [{ role: 'user', content: '部署 v2，然后等它跑完' }], {
  model, systemPrompt: '', tools: createCodingTools(cwd),
  onEvent: e => {
    if (e.type === 'message') {
      session.appendMessage(e.message);
      if (e.message.role === 'assistant') process.stdout.write(`${session.file}\n`);   // 告诉父进程会话文件在哪
    }
  },
});
