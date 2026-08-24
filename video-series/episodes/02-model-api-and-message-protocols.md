# Learn Pi Agent 02｜三种模型 API，为什么能跑同一个 Agent

- 对应课程：第 2 章
- 核心问题：OpenAI Chat、OpenAI Responses 和 Anthropic Messages 的字段不同，Agent Runtime 怎样统一处理？
- 核心结论：三种 API 都在表达“输入—模型响应—工具请求—工具结果—继续生成”；Pi 通过 Provider Adapter 把字段差异收敛为统一消息和事件。
- 无声分镜基准：82 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 三个 API 标识从三边进入 | ① |
| 06–15s | `02-api-request-response.png` | 请求和响应形成往返箭头 | ② |
| 15–24s | `03-api-sdk-runtime.png` | API、SDK、Runtime 三层分开 | ③ |
| 24–34s | `04-openai-chat-tool-call.png` | `tool_calls` 与 `role: tool` 配对 | ④ |
| 34–44s | `05-anthropic-tool-use.png` | `tool_use`、`tool_result` 内容块配对 | ⑤ |
| 44–54s | `06-openai-responses-items.png` | Item 流按类型出现 | ⑥ |
| 54–64s | `07-three-protocols-one-semantics.png` | 三路字段汇入同一语义链 | ⑦ |
| 64–73s | `08-pi-provider-adapter.png` | Adapter 把三种格式映射为统一类型 | ⑧ |
| 73–82s | `09-streaming-and-stop-reason.png` | 增量事件合并成完整 Message | ⑨ |

## 连续口播稿

① 同样是工具调用，三种模型 API 为什么长得完全不同？关键是别把某一家的字段，当成 Agent 的通用概念。

② API 定义请求和响应格式：应用发送模型、输入与参数，服务返回文本、工具请求、用量和停止信息。

③ SDK 把 API 包装成语言方法；Runtime 维护循环、状态和工具执行。它们不在同一层。

④ Chat Completions 用 `tools` 描述能力，用 `tool_calls` 请求调用；宿主执行后，再用 `role: tool` 和调用 ID 写回结果。

⑤ Anthropic 把它们表示成内容块：模型返回 `tool_use`，结果以 user message 中的 `tool_result` 送回。

⑥ OpenAI Responses 使用 Item：消息、函数调用和函数结果都是不同类型的输入或输出项。

⑦ 字段虽然不同，语义链相同：描述工具，收到带 ID 的请求，执行动作，写回关联结果，再继续生成。

⑧ Pi 用 Provider Adapter 完成转换，让上层只处理统一消息、内容块和流式事件。

⑨ Streaming 先产生增量事件，再汇成完整消息；工具参数和停止原因也要适配。下一章，我们看统一消息怎样推动 Agent Loop。

## 事实锚点

- SDK 包装 API；Agent Runtime 不等于模型 SDK。
- Anthropic 的 `tool_result` 位于 user message 的内容块中，这不表示“用户亲自执行了工具”。
- 流式 delta 是增量事件，不能在尚未完成时当作完整 Tool Call 或 Message。
