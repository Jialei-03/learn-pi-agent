# Learn Pi Agent 04｜Tool Call 不是动作：工具到底怎样执行

- 对应课程：第 4 章
- 核心问题：模型提出一个函数调用之后，真实系统还必须完成哪些步骤？
- 核心结论：可靠工具系统由 Tool Contract、Schema、Registry、Validation、Policy、Executor 和 Result 共同组成，并用调用 ID 保持请求与结果关联。
- 无声分镜基准：82 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 函数气泡停在“执行”门外 | ① |
| 06–15s | `02-request-not-action.png` | 请求和真实动作明确分层 | ② |
| 15–24s | `03-tool-and-agent-tool.png` | 通用 Tool 与 Pi `AgentTool` 对照 | ③ |
| 24–34s | `04-schema-policy-executor.png` | 三道关卡依次打开 | ④ |
| 34–44s | `05-call-id-correlation.png` | ID 连线把调用和结果锁定 | ⑤ |
| 44–54s | `06-execution-pipeline.png` | 执行管线逐段流动 | ⑥ |
| 54–64s | `07-policy-hooks.png` | 执行前后 Hook 在边界出现 | ⑦ |
| 64–73s | `08-parallel-sequential.png` | 并行分叉与顺序阻塞对比 | ⑧ |
| 73–82s | `09-tool-search.png` | 大工具库先检索再装入上下文 | ⑨ |

## 连续口播稿

① 模型输出 `delete_file`，文件就被删了吗？没有。Tool Call 是请求，真实动作仍要跨过宿主执行边界。

② 请求里只有工具名、参数和调用 ID。宿主还要检查工具、参数、权限和执行环境。

③ 通用 Tool 描述模型可请求什么；Pi 的 `AgentTool` 再装入参数 Schema、显示信息和执行函数。

④ Schema 检查结构，Policy 判断是否允许，Executor 才产生副作用。参数合法不等于动作安全。

⑤ Tool Result 必须带回调用 ID。多个并行请求不能靠数组顺序猜结果归属。

⑥ Pi 收集调用、校验参数、发出事件、执行工具，再把 `ToolResultMessage` 写回 Context。

⑦ 执行前 Hook 可阻止或修改请求，执行后 Hook 可整理结果；参数变化后仍应重新校验和授权。

⑧ 并行能降低延迟，也会引入共享状态和取消问题；存在依赖或副作用冲突时应顺序执行。

⑨ 工具太多时，可以先做 Tool Search，只把相关定义放进 Context。下一章，我们研究模型每轮究竟看到了什么。

## 事实锚点

- JSON Schema 验证参数形状，不承担授权、安全或业务正确性判断。
- Tool Call 与 Tool Result 应通过稳定 ID 关联。
- 并行工具的完成顺序不可用来推断语义顺序。
