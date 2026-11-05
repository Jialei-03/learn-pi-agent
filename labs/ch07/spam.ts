// torn.ts 的子进程：不停地往会话里追加消息，直到被杀。
import { openSession } from '../../mox/src/session.ts';

const [cwd, home] = process.argv.slice(2);
const session = openSession(cwd, home);
for (let i = 0; ; i++) session.save({ role: 'user', content: `第 ${i} 条：${'字'.repeat(2000)}` });
