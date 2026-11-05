# MiniMax 实际调用观察

`minimax-m31-flash-2026-11-05.json` 来自 2026-11-05 对 MiniMax 中国区 OpenAI 兼容端点的两次实际请求。请求和响应报告的模型名称均为 `MiniMax-M3.1-Flash`。

实验只发送合成提问、工具说明和临时创建的 README。记录包含响应中的工具调用增量、API 返回的 id、原样回传的 tool_call_id、文件内容、第二次回答、结束原因和用量；不包含密钥和推理原文。这是脱敏后的字段投影，不是完整 HTTP 字节抓包。

第一轮未返回非空 reasoning_content，`reasoning_returned_unchanged` 为 null，表示本次没有验证这一分支，不表示失败或已经验证通过。保存推理字段的代码分支另由本地模拟服务测试，不能拿该离线测试冒充真实服务的行为。

只读展示，不联网、不产生模型用量：

```bash
node labs/ch02/show-minimax-record.mjs
```

重新采集会调用真实服务，需要在终端提供 MINIMAX_API_KEY；国际区默认端点为 https://api.minimax.io/v1，中国区按账户使用 https://api.minimaxi.com/v1：

```bash
MINIMAX_BASE_URL=https://api.minimaxi.com/v1 python3 labs/ch02/minimax-live.py --record /tmp/my-minimax-observation.json
```

`test-minimax-live.py` 只访问本地假服务，用来检查切包、id 关联、推理字段保留与输出脱敏，不会生成真实调用的公开记录。

## mox 录下的一次流式回复

`minimax-m31-flash-stream.sse` 是 MiniMax-M3.1-Flash 一次流式回复的**响应体原始字节**：2026-11-05 用 mox 的 `openai()` 发出一次请求（一句提问加一个 `read_file` 工具说明），只在 `fetch` 外面包一层把响应体抄下来，不含请求头，所以没有 Key。内容是 23 个 `reasoning_content` 块、3 个正文块、2 个各自完整的工具调用块，没有用量块。

`replay.ts` 把它每 7 字节切一刀，分别交给 mox 的 `openai()` 和 Pi 的 openai-completions 适配器；`inspect-recorded.ts` 统计它的块。两者都只读文件，不联网。重新录制需要设置 `MOX_BASE_URL`、`MOX_API_KEY`、`MOX_MODEL`，会产生真实用量：

```bash
node labs/ch02/record-stream.ts
```
