// 第 7 章“你来改”的参考答案：给 mox 的平铺会话加上“从第 n 条消息处分叉”。
// 不动 mox，只用它公开的 openSession：新开一个会话文件，把前 n 条消息复制进去。
import { openSession, type Session } from '../../mox/src/session.ts';

/** 保留 source 的前 count 条消息，写进一个新文件，返回新会话。原来的文件一个字节都不动。 */
export function forkSession(source: Session, count: number, cwd: string, home: string): Session {
  let fork = openSession(cwd, home);
  // 文件名是毫秒级的时间戳；同一毫秒里开两次会拿到同一个文件名，等一毫秒再开
  while (fork.file === source.file) {
    const until = Date.now() + 1;
    while (Date.now() < until);
    fork = openSession(cwd, home);
  }
  for (const message of source.messages.slice(0, count)) {
    fork.messages.push(message);
    fork.save(message);
  }
  return fork;
}
