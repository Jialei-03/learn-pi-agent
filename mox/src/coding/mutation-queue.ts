// 同一文件的修改排队执行，不同文件仍然并行（第 4、5 章）。
// 按真实路径（realpath）分组：符号链接和相对路径指向同一个文件时，也会排进同一个队列。
// 对照 Pi：packages/coding-agent/src/core/tools/file-mutation-queue.ts
import { realpath } from 'node:fs/promises';

const queues = new Map<string, Promise<unknown>>();
let registration: Promise<unknown> = Promise.resolve();

export async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  // 登记本身也排队：保证“谁先调用，谁先拿到锁”，不因 realpath 返回的快慢而乱序
  const ticket = registration.then(async () => {
    const key = await realpath(path).catch(() => path);  // 文件还不存在时用原路径
    const previous = queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>(r => (release = r));
    const chained = previous.then(() => mine);
    queues.set(key, chained);
    return { key, previous, chained, release };
  });
  registration = ticket.catch(() => {});
  const { key, previous, chained, release } = await ticket;
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (queues.get(key) === chained) queues.delete(key);
  }
}
