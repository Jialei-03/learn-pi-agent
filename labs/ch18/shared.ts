// 第 18 章实验共用：等 Pi 会话完全空闲（后台通知、目标循环都可能在 prompt() 返回之后再开始新的运行）。
export async function idle(session: { isIdle: boolean }, settleMs = 300, timeoutMs = 20_000) {
  const start = Date.now();
  let quietSince = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 50));
    if (!session.isIdle) quietSince = Date.now();
    else if (Date.now() - quietSince >= settleMs) return;
  }
}
