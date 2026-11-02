# Pi Agent 源码学习路线

课程从同一个问题展开。给 Pi 一句「读取 README」，哪一行代码最终打开了文件，哪些数据决定模型下一次看到什么？第一章的网页实验可以直接运行。图中的模型回复来自本地脚本，所有工具分支可以稳定复现。[从第一章开始](01-from-llm-to-agent.md)

## 先认出请求经过的四层

| 从哪里看 | 谁接手 | 可观察的边界 |
| --- | --- | --- |
| 终端或 SDK | AgentSession | 用户输入进入产品会话，运行事件返回订阅者 |
| 会话中的 Agent | Agent Loop | 消息和可用工具进入循环，产生每轮的请求与结果 |
| 模型适配层 | Provider | Pi 消息转成服务接受的请求，流式回复转回统一消息 |
| 工具的执行函数 | 文件系统、子进程或远端服务 | 参数经过检查，工具结果通过调用编号回到上下文 |

SessionManager 保存可恢复的会话分支。它与组织模型调用的 ModelRuntime 作用不同。读第一章的对象表可以看到这些对象怎样装配。[第一章](01-from-llm-to-agent.md) · [装配源码](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts)

## 按机制阅读

1. **一次运行怎样走完。** 第 1～4 章用同一个文件解释消息形状、Provider 转换、两层循环、工具校验和失败返回。读完可以从工具结果反查是哪一次调用生成了它。[模型协议](02-model-api-and-message-protocols.md) · [循环](03-agent-loop-state-machine-and-stopping.md) · [工具](04-tools-and-function-calling.md)
2. **模型下一次看到了什么。** 第 5～6 章跟踪系统指令、会话树、活动分支以及压缩边界。第六章可以逐帧查看一次切分，比较原记录与恢复出的消息。[上下文](05-context-engineering-and-structured-output.md) · [会话投影](06-session-memory-retrieval-and-compaction.md)
3. **新能力怎样进入同一个循环。** 第 7～9 章分别从远程服务、磁盘上的 Skill 和扩展函数出发，定位它们在发现、注册、请求和执行阶段的接入点。[MCP](07-mcp-protocol-and-pi-integration.md) · [Skill](08-skills-and-prompt-templates.md) · [扩展](09-extensions-plugins-and-packages.md)
4. **应用和长任务怎样组合这些能力。** 第 10～18 章覆盖编排、计划、SDK、子进程、持久执行、安全策略和评测。想先在应用里嵌入 Pi，可以直接运行第十三章的离线 SDK 会话，再回到各个专题。[SDK 运行示例](13-agent-sdk-and-app-integration.md) · [完整目录](00-course-structure.md)

所有示例都附有讲解，你可以选择只在网页上沿图阅读，也可以在本地运行同一份程序。查询某个函数属于哪个包时，可使用[源码地图](../references/source-map.md)和[术语表](../references/glossary.md)。
