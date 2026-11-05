# 离线协议样本

`anthropic-tool-call.sse` 与 `openai-tool-call.sse` 表达相同的文字和读文件意图，但采用不同服务商的消息格式。

这些文件没有附带可核验的线上采集时间、请求和来源记录，因此课程把它们作为测试样本，不称作真实 API 录制。`mock-server.ts` 将样本每 7 字节拆分发送，用来验证 UTF-8、SSE 与工具参数拼接。Anthropic 那一份只有 Pi 的适配器读得了（mox 没有 Anthropic 适配器），练习的参考答案 `../adapter.ts` 也读它。

实际 MiniMax 调用的脱敏观察放在相邻的 `../recorded/`，其来源和使用方式单独说明。
