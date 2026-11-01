# 术语表

术语按实现层次组织；同名 Context 或 Session 在不同包中可能表示不同对象，阅读时要看所属类型。

| 术语 | 在课程中的含义 |
| --- | --- |
| Host / 宿主 | 调用模型、持有工具和执行环境的应用程序 |
| Agent | 由运行时组织模型、工具和反馈的运行系统 |
| Runtime / 运行时 | 推进调用、状态、事件与工具执行的代码 |
| Harness | 将模型、工具、运行时、上下文和会话等装配起来的运行层 |
| Provider | 连接模型服务并适配协议和能力的实现 |
| Message | 带角色和内容的一条交互记录 |
| SystemMessage | 表达指令、命名提示章节和工具声明变化的消息 |
| Context（模型） | 本次请求交给模型的输入 |
| Context（Chord） | 显式携带取消、遥测和调用上下文的对象 |
| State | 程序推进运行所需的当前状态 |
| Session | Coding Agent 中可保存和恢复的会话记录及管理边界 |
| Conversation | Durable 中由条目构成的对话与任务归属单位 |
| Turn | 一次模型响应及其工具处理 |
| Run | 从输入到这段运行停止的过程，可包含多个 Turn |
| Tool | 宿主提供的可执行能力 |
| Tool Declaration | 给模型看的名字、说明、Schema 等声明 |
| ToolCall | 模型提出的结构化工具请求 |
| ToolResult | 宿主执行后生成并关联原请求的结果 |
| Schema | 参数或输出数据结构的契约 |
| Hook | 在明确生命周期边界运行的回调 |
| Streaming | 通过增量事件交付响应 |
| Steering | 在运行中的后续边界进入当前工作的输入 |
| Follow-up | 等待当前工作自然停止后接续的输入 |
| Compaction | 通过摘要和保留边界减少模型上下文 |
| Retrieval | 根据需要查找窗口外或外部材料 |
| Memory | 系统选择跨任务保存和取用信息的策略 |
| Skill | 指导任务方法的可发现指令资源 |
| Prompt Template | 调用前展开参数的可复用输入文本 |
| Extension | 注册工具、命令、事件和界面行为的宿主代码 |
| Package | 分发扩展、Skill、模板和主题的资源单位 |
| MCP | 外部能力与资源接入的协议边界 |
| Code Mode | 用程序化表达组合工具调用的能力 |
| Workflow | 应用代码预先定义的步骤和转移 |
| Orchestrator | 调度节点或 Agent 的管理层 |
| Subagent | 具有独立循环、上下文和生命周期的子 Agent |
| Sandbox | 对实际进程可访问资源施加强制限制的环境 |
| Project Trust | 控制项目资源是否加载的信任决定 |
| Durable Execution | 通过持久状态与恢复机制继续执行任务 |
| Commit | 原子保存相关状态变化的提交 |
| Checkpoint | 任务恢复时使用的持久进度状态 |
| Submission | Durable 接纳的输入或写入及其结果句柄 |
| Replay | 根据恢复策略重新执行相应工作 |
| Idempotency | 重复请求不产生额外业务效果的性质 |
| Prompt Injection | 外部内容通过指令影响模型行动的攻击方式 |
| Trace / Span | 跨组件请求的因果关系与操作区间 |
| Trajectory | 一次任务的消息、工具与状态轨迹 |
| Grader | 判断任务结果的程序、人或模型评分器 |
| Eval | 在受控任务和环境下测量系统表现的过程 |
