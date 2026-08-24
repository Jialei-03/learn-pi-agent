# 术语表

这里的定义服务于阅读 Pi 与主流模型 API，追求“足够准确、能继续阅读”，不试图覆盖每个学科里的全部含义。不同厂商或框架可能使用同一个词表示略有差异的对象，遇到差异时以对应官方类型和协议为准。

## 模型与输入

### Large Language Model (LLM) / 大语言模型

根据输入 token 序列预测后续 token 的模型。在对话产品中，它通常通过消息 API 被调用。LLM 可以生成文本、结构化内容或工具调用请求，但它本身不会因为“说要执行命令”就自动获得操作系统权限。

### Model Provider / 模型供应商

提供模型、API、认证、计费与服务基础设施的组织或兼容服务。例如 OpenAI、Anthropic、Google，或实现兼容协议的本地/云服务。Pi 的 `pi-ai` 尝试把不同 Provider 的差异收敛到统一接口。

### Model / 模型

某个可被调用的具体模型及其能力配置。Provider 是服务来源，Model 是具体选择；同一 Provider 可以提供多个模型，同一模型家族也可能有不同版本。

### Token / 词元

模型处理文本时使用的离散单位，不严格等同于汉字、英文单词或字符。输入、输出、工具定义和部分隐藏内容都可能占用 token；上下文窗口和计费通常以 token 计量。

### Message / 消息

一次交互中的有角色记录，常见角色包括 system、user、assistant 与 tool。消息不一定只有纯文本，也可能包含图片、思考内容、工具请求或工具结果等内容块。

### Content Block / 内容块

一条消息内部具有明确类型的内容单元，例如 text、image、tool call、tool result。Anthropic、OpenAI 与 Pi 的字段结构并不完全相同，但都需要表达“这段内容是什么”。

### Context / 上下文

宿主程序为本次模型调用准备的输入集合，通常包含 system prompt、消息历史、工具定义和其他可用信息。

**上下文不是模型自动保存的永久记忆。** API 调用之间，通常由宿主程序保存历史并在下一次请求中重新发送。磁盘上的完整会话也不等于本轮全部进入上下文：宿主可能截断、过滤或压缩它。

### Memory / 记忆

让过去信息能够在以后被选择、更新和复用的机制。Memory 可以保存经历、事实或行为规则；它通常还需要写入条件、检索、冲突处理、权限边界和遗忘策略。Session 是 Memory 的一种信息来源，但保存 Session 不等于已经建立完整的 Memory 系统。

### Retrieval / 检索

根据当前查询从 Session、文档库、数据库或索引中找出候选信息，再经过过滤、排序和预算控制，把少量相关内容带回 Context 的过程。检索相关性不等于事实正确，也不等于调用者有权读取或执行其中的内容。

### Retrieval-Augmented Generation (RAG) / 检索增强生成

先从外部知识源检索证据，再让生成模型在这些证据条件下回答或行动的方法。RAG 提高知识的可更新性和来源可追踪性，但检索遗漏、错误排序、过期证据和不忠实生成仍需分别评估。

### Context Window / 上下文窗口

模型一次推理能够处理的 token 总容量及相关限制。它通常要容纳提示、历史、工具定义、工具结果和输出预算。窗口变大不代表模型会同等重视每个位置，也不消除成本与延迟问题。

### System Prompt / 系统提示词

由宿主提供的高优先级行为与上下文说明，常用来描述角色、规则、环境和工具使用方式。它能影响模型输出，但不是强制安全边界；真正的权限控制仍需由程序、沙箱和策略实现。

### Prompt Engineering / 提示工程

设计和组织模型指令、输入边界、示例与输出要求的方法。它主要回答“怎样表达任务”，是 Context Engineering 的组成部分。

### Context Engineering / 上下文工程

在每次模型推理前选择、组织、更新和约束全部输入信息的工程过程。它不仅包含 prompt，还包含消息历史、工具定义、项目规则、检索资料、动态状态、信任边界与 token 预算。

### Context File / 项目上下文文件

由 Harness 自动发现并加入模型上下文的项目指令文件，例如 Pi 支持的 `AGENTS.md`、`CLAUDE.md` 与 `AGENTS.override.md`。它们影响模型行为，但不是可替代代码权限检查的安全策略。

### Token Budget / Token 预算

在有限 Context Window 中为系统提示、消息、工具、文档和模型输出分配容量的计划。预算既要防止输入溢出，也要给后续 Tool Result 与最终回答保留空间。

### Reasoning / 模型推理

模型在生成答案或行动请求时进行的计算过程。某些 Provider 允许应用请求不同的 reasoning effort，并报告相应 token 用量；这不表示应用能够读取完整内部过程，也不会自动产生可恢复的执行计划。

### Reasoning Effort / 推理强度

应用向支持推理的模型提出的计算强度偏好。更高强度可能增加 token、延迟与费用，具体可选值和效果由模型决定，需要在真实任务上评估。Pi 用 `thinkingLevel` 提供统一请求语义，再由 Provider Adapter 映射到底层参数。

### Thinking Content / 思考内容块

Provider 在响应边界允许返回的 thinking 内容、摘要、签名或遮蔽表示。Pi 用 `ThinkingContent` 统一承接这类内容；它不应被默认描述为模型完整、原始且忠实的 Chain-of-Thought。

### Chain-of-Thought (CoT) / 思维链

让模型生成中间推理步骤的一类提示与研究方法。可见步骤有时能改善任务表现或帮助人理解回答，但其文字不必然完整反映实际决策因果，不能替代工具结果、测试与来源等外部证据。

### Prompt Cache / 提示缓存

Provider 对重复提示前缀进行复用的机制，可以降低部分延迟或费用。被缓存内容通常仍占 Context Window；缓存命中不等于这些 token 已从模型输入中删除。

### Instruction Hierarchy / 指令层级

模型或应用按来源与信任级别解决指令冲突的规则。具体角色和优先级依 Provider 而异；宿主仍需保留来源并用权限、策略和 Sandbox 约束真实动作。

### Prompt Injection / 提示注入

把外部数据中的文字伪装成应被模型服从的指令，从而诱导系统偏离开发者或用户目标的攻击。注入可能来自用户输入，也可能间接藏在网页、邮件、代码或 Tool Result 中。

### Structured Output / 结构化输出

让模型按指定 Schema 返回可被程序消费的数据。Provider 原生 Structured Output 可以在支持的 Schema 子集内约束字段和类型，但宿主仍要处理拒绝、截断、传输错误和业务语义校验。

### JSON Mode

要求模型返回有效 JSON 的 Provider 能力。它通常只保证 JSON 可解析，不保证对象符合某个指定 Schema，因此不能与 Structured Output 视为同一层保证。

## 响应与行动

### Streaming / 流式响应

服务端在完整响应结束前持续发送增量事件，客户端可以逐步展示文本、思考片段或工具调用参数。Streaming 改变传输与交互方式，不代表模型可以任意修改已经最终确认的历史消息。

### Tool / 工具

宿主程序向模型描述的一项可请求能力，通常包含名称、用途和输入 schema；宿主还持有真正的实现。工具可以查询天气、读文件、执行命令，也可以只做纯计算。

### Tool Call / 工具调用请求

模型返回的结构化请求，通常包含工具名、调用标识和参数。它表达“模型建议或请求宿主调用这个工具”。

**Tool Call 不是已经执行的动作。** 宿主程序必须验证工具是否存在、参数是否合法、权限是否允许，然后才决定是否执行。

### Tool Result / 工具结果

宿主执行工具后形成的结构化结果消息，并通过调用标识与对应 Tool Call 关联。结果可能成功，也可能表示验证失败、权限拒绝、超时或工具错误；模型随后基于这个结果继续生成。

### Tool Schema / 工具模式

描述工具输入结构的 schema，常使用 JSON Schema 的一部分。它帮助模型生成参数，也帮助宿主校验输入，但不能代替业务授权、路径边界、速率限制等安全检查。

### Function Calling / 函数调用

模型 API 用结构化工具定义和参数表达外部函数请求的机制。模型生成函数名与参数，客户端或供应商托管环境负责真实执行；因此 Function Call 本身不是普通编程语言中的直接函数调用。

### Tool Registry / 工具注册表

让 Runtime 按稳定名称找到当前可执行工具定义与实现的集合。它可以是一张 Map、一个数组或专门的注册服务；Pi 低层循环由 `AgentContext.tools` 与按名称查找承担这一职责，没有单独的 `ToolRegistry` 类。

### Tool Policy / 工具策略

根据用户身份、参数、环境和风险决定某次工具调用是否允许、阻止或需要批准的规则。Schema 负责参数形状，Policy 负责授权与执行边界；Pi 的 `beforeToolCall` 是策略进入低层循环的一个位置。

### Tool Executor / 工具执行器

在校验和策略检查之后真正运行工具实现、响应取消信号、报告进度并把成功或异常转换成统一结果的组件或阶段。

### Tool Search / 工具搜索

从较大的工具目录中发现当前任务相关工具，并按需把少量工具定义加载进模型上下文的机制。它减少工具 Schema 的初始 token 占用；发现相关工具不等于获得执行权限。

## 循环与状态

### Agent / 智能体

在本仓库中，Agent 指宿主程序围绕模型组织的、有状态且可以反复观察结果并继续行动的运行过程。它通常组合模型、上下文、工具、循环、停止条件和事件。不同论文与产品的定义会更宽或更窄。

### Agent Loop / Agent 循环

反复执行“准备上下文 → 调用模型 → 检查工具请求 → 执行并回填结果 → 判断是否继续”的控制循环。循环由代码运行，模型只是其中一个决策组件。

### Turn / 轮次

循环中的一次模型响应及其相关工具处理边界。日常所说“一问一答”不一定等于 Pi 中一个 turn：一个用户目标可能触发多次模型—工具往返。

### Run / 一次运行

应用接受一项输入后，由 Agent Runtime 持续处理到完成、暂停、失败或取消的过程。一次 Run 可以跨越多个 Turn，并产生多条 Message 与 Tool Result；它通常短于 Session 的生命周期。

### Session / 会话

跨多个 turn 保存的交互历史与元数据。Session 可以落盘、恢复、分支或压缩；它是宿主系统管理的状态，不等同于模型内部永久记忆。

### Session Tree / 会话树

用稳定节点标识和父节点关系保存会话历史的树结构。Pi 的 Session Entry 通过 `id` 与 `parentId` 形成追加写入的树，当前叶子决定活动分支；回到旧节点继续会产生新分支，而不必删除原路径。

### State / 状态

运行过程中需要延续的可变信息，例如消息列表、当前模型、工具配置、是否正在流式生成、错误或停止原因。清楚“谁拥有状态”是阅读 Agent 工程的关键。

### Event / 事件

对运行过程中某个事实或阶段的结构化通知，例如 agent 开始、消息增量、工具执行开始和 turn 结束。事件让界面、日志或遥测观察循环，而不必把显示逻辑写进核心控制代码。

### Compaction / 上下文压缩

当会话接近上下文限制时，把较早内容摘要、替换或裁剪，以降低后续请求的 token 占用。Compaction 保存的是有损表示，不保证所有细节都能恢复；磁盘历史、压缩摘要与模型本轮上下文应分别讨论。

### Checkpoint / 检查点

足以让运行系统从一个已确认位置恢复计算的持久化状态。它通常记录当前阶段、操作标识、等待输入、重试或取消状态，以及已经确认的结果。语义摘要可以帮助模型继续理解任务，但不自动等于精确的运行 Checkpoint。

### Durable Execution / 持久化执行

通过持久化控制状态、恢复协议和重试策略，让长任务在进程或基础设施故障后继续运行的工程机制。Durable Execution 仍需处理“副作用可能已经发生但结果尚未确认”的窗口，常与幂等键、去重和明确的 replay policy 组合。

### Background Execution / 后台执行

请求发起方断开连接后，任务仍能在服务端继续运行，并可通过标识查询、取消或取得结果的执行方式。Background 解决“连接不必一直保持”，Durable 解决“进程或基础设施失败后怎样从已确认位置继续”；两者可以组合，但语义并不相同。

### Operation State / 操作状态

让运行时知道当前正在处理哪项操作、下一步应进入哪个控制位置、哪些 Effect 已提出或已确认的持久化状态。它比普通业务数据快照多保存一层程序进度，是精确 Resume 与 Replay 的基础。

### Retry / 重试

从同一操作边界再次尝试一次失败或未确认的动作。Retry 是否安全取决于错误类别、动作是否有副作用、是否使用稳定幂等键，以及上一次尝试是否可能已经生效。

### Resume / 恢复继续

从已经持久化的 Run 或 Checkpoint 继续推进。Resume 描述恢复入口，不保证底层不会 Replay 某段控制逻辑，也不保证外部 Effect 只执行一次。

### Replay / 重放

根据持久化事件或操作记录重新执行确定性的控制逻辑，以重建当前状态或推进到已知位置。外部网络、文件、模型调用等非确定动作应隔离为受记录的 Effect / Activity，不能在重放过程中无条件再次触发。

### Restart / 重新开始

放弃原 Run 的控制进度，从任务输入创建新的 Run。Restart 可能复用业务数据，但与从原 Checkpoint Resume 不同；旧 Run 已经产生的外部副作用仍需查询、去重或补偿。

### Side Effect / 外部副作用

会改变运行系统之外可观察状态的动作，例如付款、发消息、写数据库、创建工单或修改远端仓库。模型生成文字通常可重新计算，已经触发的外部副作用却不能靠删除本地消息撤销。

### Effect sandwich / 副作用三段式

把外部动作拆成持久化意图、实际执行和持久化结算三段。执行成功但结算尚未写入时形成不确定窗口；恢复器需要借助幂等键、查询、replay policy 或人工处理判断下一步，而不能凭缺少结果就认定动作没有发生。

### Compensation / 补偿

当已经提交的外部动作无法原子回滚时，用另一个业务动作抵消或修正其影响，例如取消预订、退款或提交反向变更。补偿不是数据库回滚的同义词，它本身也可能失败，并需要审计、重试和人工升级路径。

### Idempotency / 幂等性

同一个操作重复执行多次，系统最终结果与执行一次相同的性质。可重试的外部写操作常使用稳定 idempotency key 让接收方识别重复请求；幂等性是应对崩溃和网络重试的重要手段，不代表底层函数只会被调用一次。

### Steering / 运行中引导

Agent 尚在执行时，宿主把新用户指令注入后续 turn，用于纠正方向或追加约束。它需要明确消息进入时机，避免与正在执行的动作产生含糊竞态。

### Follow-up / 后续消息

Agent 原本已经没有工具续轮或 steering 消息、准备结束当前 run 时，宿主再取出的排队消息。它适合表达“当前任务做完后，再做这件事”；与 steering 的差别主要是注入时机，而不是消息角色。

### Stop Reason / 生成停止原因

描述一次模型生成为什么结束的字段，例如自然结束、达到输出上限、请求工具、出错或取消。它不等同于完整 Agent run 的结束原因；Runtime 还会检查 Tool Call、工具结果、宿主策略和排队消息。

### AbortSignal / 取消信号

JavaScript 中协作式取消异步工作的信号。宿主触发取消后，Provider、工具或回调需要在安全边界读取并响应信号；它不是强行终止整个进程，也不能保证不配合的实现立刻停止。

## 工程装配与生态

### Harness / 运行编排层

把模型、工具、上下文、状态、事件、生命周期与宿主环境连接起来的工程层。Pi 将自己称为 Agent Harness，强调的不只是一个循环函数，还包括使 Agent 可交互、可扩展、可恢复的配套结构。

### Model SDK / 模型 SDK

把模型服务的 HTTP API 包装成某种编程语言方法的客户端库。它负责请求、认证、类型和流式响应等模型访问问题，但是否推进 Tool Loop、保存 Session 或执行工具，要看具体库是否另外提供 Agent Runtime 能力。

### Agent SDK

把 Agent 定义、运行循环、Tool、Session、事件与生命周期作为可编程接口交给应用的库。它适合把 Agent 嵌入网页、桌面应用、服务或 Workflow；应用仍负责用户体系、权限、部署、数据策略和产品界面。

### ModelRuntime / 模型运行层

Pi coding-agent 中集中管理 Provider、模型目录、认证状态、可用性与模型查找的对象。多个 AgentSession 可以共享应用级 ModelRuntime；它不等于某一次 Agent Run，也不替代 Session。

### Run Context / 本地运行上下文

某些 Agent SDK 在一次 Run 中传给 Tool、Handoff 或生命周期代码的本地依赖与业务数据，例如用户身份或数据库连接。它默认不等于发送给模型的 Context；模型需要的数据仍要经过明确选择后进入消息、指令或 Tool Result。

### View State / 界面状态

应用根据运行事件维护的展示状态，例如正在生成、正在调用工具、重试、完成或取消。View State 服务于按钮、气泡与进度卡片，可以由事件和权威消息重建，不应与模型消息或 Session 历史混为一体。

### Workflow / 工作流

由预先定义的步骤、连接规则、分支、循环和结束条件组成的任务控制过程。Workflow 的节点可以调用 LLM 或完整 Agent；只要候选路径和转移规则主要由程序拥有，整体仍然是 Workflow。

### Control Flow / 控制流

决定程序以什么顺序进入步骤、怎样分支或循环、何时结束的规则集合。分析 Workflow 与 Agent 时，最关键的问题是每一层的 Control Flow 由代码、模型还是人控制。

### Workflow Node / 工作流节点

Workflow 中一个有明确输入、输出和失败边界的执行步骤。Node 可以是普通函数、模型调用、完整 Agent Run、人工批准或子 Workflow；这个名称描述它在外层流程中的位置，不限定内部实现。

### Contract / 节点契约

节点边界上对输入、输出和失败状态的明确约定。TypeScript 类型能帮助开发阶段检查，来自模型、网络或 Tool 的运行时数据仍需 Schema 与业务规则校验。

### Transition / 状态转移

从当前节点或状态进入下一节点或状态的控制规则。顺序执行、`switch` 分支、fan-out、fan-in 与循环条件都是 Transition；规则可以由代码固定，也可以包含经过代码校验的模型判断。

### Gate / 关卡

在结果进入下一阶段前执行的通过条件，例如 Schema 校验、测试、权限检查、预算限制或人工批准。Gate 不一定生成新内容，主要负责阻止不合格状态继续传播。

### Prompt Chaining / 提示链

把任务拆成固定顺序的多个模型或 Agent 节点，并让前一步输出成为后一步输入的 Workflow Pattern。可靠的 Prompt Chaining 需要中间 Contract 与 Gate，而不只是连续调用多次模型。

### Routing / 路由

先把输入映射到有限的结构化类别，再由程序选择专门节点或子 Workflow 的模式。路由结果需要运行时校验、未知类别兜底和基于真实误差成本校准的置信度策略。

### Parallelization / 并行化

让互不依赖的节点并发执行，再按明确规则收集结果。常见形式包括拆分不同独立子任务的 Sectioning，以及对同一问题取得多个视角的 Voting；并行不会自动消除错误、竞态或取消问题。

### fan-out / fan-in / 扇出与汇入

fan-out 把一次运行分发到多个并行分支，fan-in 在分支结束后按规则收集、校验和聚合结果。只定义 fan-out 而不定义缺失、重复、冲突、超时和部分失败时怎样 fan-in，流程就没有完整完成语义。

### Orchestrator-Workers / 编排器—工作者模式

由 Orchestrator 在运行时根据任务动态产生 Work Item，再交给一个或多个 Worker 执行并汇总的模式。动态计划仍需检查任务数量、唯一标识、依赖环、权限、并发、预算和输出契约。

### Multi-Agent System / 多 Agent 系统

多个具有独立 Context、状态和运行生命周期的 Agent 通过某种编排关系共同完成目标的系统。它额外引入任务分解、通信、所有权、汇聚、预算、取消和错误传播问题；多个模型调用或同一 Context 中的多个角色并不自动构成多 Agent 系统。

### Manager / 管理 Agent

接收全局目标、选择 Worker、分配任务并汇总结果的 Agent。在 Manager–Worker 或 Agents-as-Tools 模式中，Manager 通常继续拥有用户对话和最终回答，但具体权限仍由 Harness 决定。

### Worker / 工作者 Agent

接受范围较窄的委派任务并返回结果的 Agent。Worker 可以有独立模型、Instructions、Tool、Context 与预算；它的结果仍需由调用方校验。

### Subagent / 子 Agent

相对于某个父 Agent 或编排器被创建、调用或管理的 Agent。这个名称描述协作关系，不是模型类别或统一协议类型；本地进程、SDK 对象和远程服务都可能充当 Subagent。

### Agent-as-Tool / Agent 即工具

把 Specialist Agent 包装成 Manager 可调用 Tool 的模式。Specialist 在内部运行自己的 Agent Loop，并把压缩结果作为 Tool Result 返回；Manager 不转移用户会话的控制权。

### Handoff / 对话移交

把当前运行或对话的活跃处理者从一个 Agent 转交给另一个 Agent 的编排动作。它不同于 Agents-as-Tools：后者返回一个子任务结果，前者让接收 Agent 继续面向用户处理。

### Delegation / 委派

一个 Agent 或编排器把一项有边界的工作交给另一个 Agent 的动作。它可以通过 Agent-as-Tool、Handoff、本地队列或 A2A 等机制实现。

### A2A / Agent2Agent Protocol

面向不透明 Agent Service 的开放互操作协议。A2A 1.0 通过 Agent Card 发现能力，通过 Message 发起或继续交互，通过 Task 跟踪有状态工作，并用 Artifact 表达正式产物；它不是 Agent SDK、内部 Subagent 编排器或 MCP 的替代品。

### Agent Card / Agent 能力卡

A2A Server 对外提供的 JSON 元数据，描述身份、Agent 版本、支持的接口与协议版本、能力、认证要求、输入输出 Media Type 和 Skill。A2A 1.0 的接口位于 `supportedInterfaces`，而不是旧版常见的顶层 `url` 与 `protocolVersion`。

### A2A Task / A2A 任务

A2A Server 创建并管理的有状态工作单元，具有 `taskId`、`contextId`、状态、历史和 Artifact。终止状态的 Task 不可重启；后续完善通常在同一 `contextId` 中建立新 Task。

### Artifact / 任务产物

A2A Task 产生的正式交付物，例如报告、图片、文件或结构化数据。Artifact 由一个或多个 Part 构成，可在 Streaming 中分块更新；它与用于交流、提问或状态说明的 Message 不同。

### Evaluator-Optimizer / 评价—优化模式

生成节点给出候选，评价节点按明确标准返回可执行反馈，优化节点据此继续修改的有界循环。达到最大次数只表示预算用完，不等于通过；工程实现通常还要保存最佳候选，并优先使用测试、Schema 与业务规则等外部证据。

### Execution Plan / 可执行计划

由 Harness 保存和校验的计划状态，通常包含目标、步骤、依赖、允许工具、成功标准、状态和执行证据。自然语言步骤列表可以作为草稿；只有进入明确数据结构后，应用才能可靠地审批、调度、更新和恢复它。

### ReAct

让模型在推理、行动与环境观察之间交替的一种经典模式。现代系统常用结构化 Tool Call 与 Tool Result 实现类似轨迹，不一定输出字面的 `Thought`、`Action` 和 `Observation`；具体 Runtime 仍需处理校验、权限、停止与状态。

### Plan-and-Execute / 计划—执行

先由 Planner 产生可检查计划，再由 Executor 按步骤调用工具、保存证据并在环境变化时 Replan 的运行结构。它跨越模型、状态和控制流，不等同于一次回答内部“先列提纲再作答”的 Plan-and-Solve prompting。

### Replan / 重规划

根据当前计划、已完成步骤、失败证据、环境变化和剩余预算，修改尚未完成部分的过程。重规划不应默认丢弃全部历史或重放已经产生不可逆副作用的步骤。

### Critic / 评价者

按明确标准检查候选并返回问题、证据和修改建议的角色。Critic 可以由同一模型、另一模型、规则、测试或人承担；角色名称本身不提供独立事实，也不保证评价正确。

### Reflection / 反思

根据目标、实际结果和反馈证据，总结偏差原因与下一次具体调整的信息。没有绑定运行事实的笼统“下次更仔细”很难改善执行，也不应直接写入长期 Memory。

### Self-Refine / 自我改进

在当前任务中反复执行“生成 → 自反馈 → 修订”的方法。工程循环仍需通过条件、最大次数、最佳候选和外部验证；重复自评不保证结果单调变好。

### Reflexion

把语言形式的反思保存到 episodic memory，并让后续 trial 利用这些经验的方法。它不更新模型权重；错误反思可能持续影响后续决策，因此需要验证、去重、过期和作用域控制。

### Self-Consistency / 自洽性采样

对同一问题采样多条推理路径，再按规范化后的最终答案进行聚合的解码策略。它不是简单“再检查一次”，也不保证多数样本不会共享同一错误。

### Tree of Thoughts (ToT) / 思维树

把中间候选作为搜索状态，由外部控制器执行展开、评价、选择、剪枝和回溯的方法。真正的 ToT 需要保存节点、父子关系、frontier 与预算；一份包含多个方案的提纲并不等于搜索树。

### Plan Mode / 规划模式

产品或 Harness 在调查、计划、批准和执行阶段之间切换能力与权限的工作模式。可靠的 Plan Mode 需要实际 Tool Allowlist、文件或网络作用域、审批状态和事件记录，不能只依靠模型承诺不修改内容。

### Orchestrator / 编排器

协调步骤或参与者、传递状态并选择下一步的组件或角色。Orchestrator 可以由普通代码、状态机或 LLM 实现；这个名称本身不能说明系统是 Workflow 还是 Agent。

### Code Orchestration / 代码编排

由代码根据显式状态和预定义规则选择下一节点的编排方式。它可以包含模型分类、生成或 Agent 节点，但业务分支、重试、批准和副作用通常仍由程序控制。

### LLM Orchestration / 模型编排

让模型根据目标与中间结果动态拆解任务、选择工具或参与者并决定后续行动的编排方式。它提高对开放任务的适应能力，也需要轮次、费用、权限、停止和失败处理边界。

### Hybrid Orchestration / 混合编排

在同一系统中嵌套代码编排与模型编排。常见结构是外层 Workflow 固定业务阶段、校验、人工批准和高风险副作用，内层 Agent 负责无法提前穷举的调查或生成过程。

### Bounded Autonomy / 有边界的自主性

宿主先规定可用 Tool、权限、数据范围、预算和停止条件，再允许模型在这些边界内动态选择行动。它强调 Agent 的自主选择范围始终由运行环境约束。

### Extension / 扩展

通过 Harness 定义的扩展点添加或改变能力的可执行代码模块。Pi Extension 由 factory function 接收 `ExtensionAPI`，可以注册 Tool、Command、Provider、UI 与生命周期事件处理器。它与宿主进程共享系统权限，应像依赖和插件一样评估来源、依赖、更新与运行权限。

### ExtensionAPI / 扩展注册接口

Pi 在加载 Extension factory 时传入的能力入口。它提供 `registerTool()`、`registerCommand()`、`registerProvider()`、`on()` 等注册方法，并让 Extension 在 Harness 已定义的边界接入运行，而不必自行接管 Agent Loop。

### Hook / Event Handler / 生命周期处理器

Extension 通过 `pi.on(event, handler)` 注册的函数。Harness 到达对应阶段时调用它；不同事件可以观察、修改、阻止或补充输入、Context、Tool Call、Tool Result、Session 与 Provider 请求。Hook 是确定边界上的代码，不是独立 Agent。

### Command / 扩展命令

由用户通过 slash command 直接触发的 Extension 入口。Command handler 默认不需要模型先做选择，也不会自然形成 Tool Call；它与会展开成用户消息的 Prompt Template、Skill Command 属于不同分发路径。

### Pi Package / Pi 分发包

Pi 可安装的资源目录，可以组合 Extension、Skill、Prompt Template 与 Theme，并通过 npm、Git 或本地路径获取。Package 既可以显式声明 `pi` manifest，也可以采用约定目录；它是分发单元，不等于单个 Extension，也不要求发布到 npm。

### Plugin / 插件

产品定义的可安装能力容器，而不是跨 Agent 产品统一的格式。不同产品支持的组件、manifest、权限与安装方式可能完全不同；能跨产品复用的通常是其中遵循 Agent Skills、MCP 等开放标准的部分，而不是整个 Plugin 包。

### Middleware / 中间件

多个处理器按确定顺序作用于同一运行边界，并把修改后的数据传给下一个处理器的组合方式。Pi 的 `context`、`before_agent_start` 与 `tool_result` 等事件具有这类串联语义；加载顺序会影响最终结果。

### Skill / 技能

为 Agent 提供特定任务知识、步骤或资源的可加载目录。Agent Skills 开放格式以 `SKILL.md` 为入口，可附带 scripts、references 与 assets。Skill 影响“怎样完成任务”，但不会凭空增加宿主未提供的 Tool 或权限；搜索路径、调用方式与额外字段由 Harness 决定。

### SKILL.md

Agent Skill 的入口文件，由 YAML frontmatter 与 Markdown 正文组成。开放规范要求 frontmatter 至少包含 `name` 与 `description`；正文存放核心工作方法，并用相对路径指向脚本、参考资料或资产。

### YAML Frontmatter

Markdown 文件开头、由两条 `---` 包围的结构化元数据。Harness 可以在不读取整篇正文的情况下解析字段，例如 Skill 的 `name`、`description`，或 Prompt Template 的 `argument-hint`。

### Skill Catalog / Skill 索引

Harness 在会话开始时提供给模型的可用 Skill 摘要，通常包含名称、描述和文件位置。它让模型知道有哪些方法可选，但不等于完整 `SKILL.md` 已经进入 Context。

### Progressive Disclosure / 渐进式披露

先提供少量元数据用于选择，再在任务相关时加载完整说明，最后按需读取脚本、参考资料与资产的 Context 管理方法。它降低初始 token 成本，也减少无关指令对模型注意力的干扰。

### Prompt Template / 提示模板

可复用、可带参数的提示文本。Pi 根据文件名注册 slash command，并在模型调用前把 `$1`、`$@` 或默认值等占位符替换为用户参数；展开结果是一条普通用户消息，不会自行执行 Tool。

### `allowed-tools`

Agent Skills 规范中的实验性可选字段，用于声明预批准工具。不同 Harness 对它的解析和权限含义并不一致，不能把它当成跨产品通用的安全授权；Pi 固定源码没有用它替代 Tool Runtime 的权限检查。

### ResourceLoader / 资源加载器

发现、选择并加载提示、规则、Skill 或项目资源的组件。它解决“哪些上下文在什么时候进入会话”，因此既影响能力，也影响上下文预算与信任边界。

### Provider Adapter / 供应商适配器

把统一模型类型转换为某个 Provider 请求格式，并把响应事件转换回统一表示的代码。适配器应处理字段差异和能力差异，而不是假设所有厂商 API 完全同构。

### MCP / Model Context Protocol / 模型上下文协议

一种连接 AI 应用与外部工具、资源和提示的开放协议。MCP 解决互操作接口，不自动解决工具可信度、用户授权、数据泄露或提示注入；协议连接成功也不等于使用安全。

### JSON-RPC

用 JSON 表达远程过程调用的消息协议。Request 使用 `id` 与 `method` 请求操作，Response 用相同 `id` 返回 `result` 或 `error`，Notification 没有 `id`、不等待响应。MCP 的基础消息格式建立在 JSON-RPC 2.0 之上。

### MCP Host

承载模型与用户体验的 LLM 应用。Host 创建 MCP Client、管理连接生命周期、聚合 Context，并保留权限、用户同意、模型调用和跨 Server 隔离的控制权。Pi coding-agent 接入 MCP 时属于 Host 一侧。

### MCP Client

Host 内部连接一个特定 MCP Server 的协议组件。一个 Host 可以管理多个 Client，但每个 Client 与一个 Server 一对一通信；Client 负责版本、能力、请求、响应和 Transport 细节。

### MCP Server

通过 MCP 提供 Tools、Resources 或 Prompts 的本地进程或远程服务。Server 应只得到当前请求所需的信息，不自动得到 Host 的完整会话，也不自动取得另一个 Server 的 Context。

### MCP Transport

承载 MCP JSON-RPC 消息的传输方式。stdio 通常由 Client 启动本地子进程并通过标准流通信；Streamable HTTP 通过每个请求一次 POST 连接远程端点。Transport 决定消息怎样移动，不改变 Tool、Resource 或 Prompt 的语义。

### MCP Resource

由 URI 标识、供 Host 按需列举和读取的数据。发现 Resource 不代表内容已经进入模型 Context；Host 仍要选择、读取、检查权限并决定怎样使用。

### MCP Prompt

Server 提供的参数化消息模板。Host 可以把它展示给用户并通过 `prompts/get` 取得填充后的消息；它不是 Tool，也不会因为来自 MCP 就自动成为可信 system instruction。

### Capability Negotiation / 能力协商

通信双方声明自己支持哪些协议能力，并只使用双方都能处理的部分。现代 MCP Request 在 `_meta` 中携带 Client Capabilities，Server 可通过 `server/discover` 返回版本与 Server Capabilities。

### Elicitation / 补充输入请求

MCP Server 在完成操作前请求 Client 一侧补充用户信息的能力，例如表单字段或确认。Host 负责怎样展示、验证和取得输入，Server 不能借此绕过用户同意与权限策略。

### MRTR / Multi Round-Trip Request

现代 MCP 中让一次操作跨多个请求继续的模式。Server 先返回 `resultType: "input_required"`、所需输入和可选 `requestState`；Client 取得输入后，用新的 JSON-RPC ID 重试原方法并携带 `inputResponses`。

## 执行环境与权限

### Code Agent / 编码 Agent

围绕代码仓库完成阅读、修改、命令执行和验证任务的 Agent 系统形态。它通常由模型、Agent Loop、仓库 Context、文件与 Shell 执行器、策略、Sandbox 和反馈机制共同组成；能够生成代码的模型不自动等于 Code Agent。

### Agent-Computer Interface (ACI)

Agent 观察并操作计算机环境的一组接口。它可以由文件查看器、编辑器、Shell、测试输出、浏览器或图形界面动作组成；接口提供的信息粒度、反馈与限制会影响 Agent 的行为和任务效果。

### Executor / 执行器

把 Tool Call 转换成真实文件操作、进程、网络请求或界面输入的宿主组件。模型提出动作，Executor 执行动作；操作系统与 Sandbox 再决定它最终能够触达哪些资源。

### Browser Automation / 浏览器自动化

通过 DOM、可访问性树、浏览器开发者协议或其他结构化页面接口执行导航、选择元素和填写表单。它与根据截图坐标操作鼠标键盘的 Computer Use 可以互补，但二者的观察方式、稳定性和风险检查不同。

### Computer Use / Computer-Using Agent

让模型根据截图或屏幕状态提出点击、拖动、滚动、输入和按键等动作，再由 Harness 执行并返回新画面的交互方式。模型不直接拥有鼠标和键盘权限；动作校验、批准、隔离和执行仍由宿主负责。

### Working Directory / 工作目录

解析相对路径和启动子进程时使用的路径起点。工作目录不是自动的访问边界；如果执行器接受绝对路径、上级路径或任意子进程，仍需路径策略与 Sandbox 限制项目外访问。

### Tool Allowlist / 工具允许列表

当前运行中暴露给模型的 Tool 集合。它可以缩小模型可请求的能力，却不自动约束 Extension、自定义代码、Shell 内部程序或宿主进程的操作系统权限。

### Policy Gate / 策略门

在动作执行前依据命令、路径、目标、风险或业务状态决定允许、拒绝或请求批准的控制点。它表达产品规则，但规则漏判时仍需 Sandbox 提供最终技术限制。

### Approval / 人工批准

让运行在某个动作实际发生前暂停，并向用户展示目标、数据与影响，由用户明确批准、修改或拒绝的控制流节点。批准表达用户意图，不会自动降低执行进程的系统权限；等待状态、决定、对象版本与恢复后的重新校验需要进入持久化状态。

### Human-in-the-loop (HITL) / 人在回路中

让人类决定、纠正或补充信息成为运行控制流的一部分。可靠的 HITL 需要明确等待什么、谁可以决定、决定对应哪个动作版本、超时或拒绝怎样转移，以及恢复执行前是否必须重新检查权限和环境。

### Sandbox / 沙箱

由操作系统、容器运行时、虚拟机或远程执行环境强制实施的资源边界，用来限制文件、进程、网络、设备与凭据访问。Sandbox 的强度取决于具体平台、挂载、身份、网络和策略配置，不能只根据产品名称判断。

### Worktree / Git 工作树

同一 Git 仓库关联的独立工作目录，可用于并行修改、比较和合并变更。Worktree 隔离版本控制修改，不隔离进程、网络、凭据或工作树外文件，因此不是 Sandbox。

### Container / 容器

通常共享宿主内核，并利用 namespace、cgroup、Linux Capability、seccomp 等机制隔离进程与资源的运行环境。可写挂载、特权模式、Socket 和网络配置会直接改变其实际边界。

### Virtual Machine (VM) / 虚拟机

通过虚拟硬件运行独立来宾操作系统和内核的隔离环境。microVM 针对较小设备模型、较快启动和任务级工作负载优化；二者通常比普通进程隔离更重，但能提供更清晰的内核边界。

### Secret / 凭据

API Key、访问 Token、密码、私钥等不应公开的数据。Agent 系统应限制 Secret 的作用域、寿命和注入阶段，避免把它写入 Context、Tool Result、日志或不需要它的执行环境。

### Egress / 出站网络

执行环境主动连接外部网络目标的流量。默认关闭、按域名或代理规则开放 Egress 可以减少数据泄露面，但仍需处理允许站点中的恶意内容、依赖供应链和私有网络地址。

### Least Privilege / 最小权限

让每个任务、进程和凭据只获得完成当前工作所需的最少能力，并限制作用域与持续时间的原则。Tool Allowlist、只读挂载、短期 Token、网络 Allowlist 和一次性 Sandbox 都可以共同实现它。

## 安全与治理

### Threat Model / 威胁模型

系统化描述要保护的资产、可能的攻击者、入口、信任边界、攻击路径和影响的安全模型。Threat Model 让控制措施对应真实威胁，而不是只堆叠过滤器。

### Trust Boundary / 信任边界

数据、身份或控制权从一个信任等级进入另一个等级的位置。用户输入进入模型、模型输出进入 Tool、MCP Client 连接第三方 Server、Extension 进入 Harness 都会跨越信任边界，并需要明确校验与权限规则。

### Provenance / 来源信息

记录一段输入、证据、指令或结果来自哪里、经过哪些转换以及具有什么信任等级的信息。保留 Provenance 可以帮助 Context Builder、Tool Policy 和 Audit 区分系统策略、用户任务与外部不可信内容。

### Jailbreak / 越狱提示

用户直接试图让模型绕过其既有行为或安全约束的输入方式。Jailbreak 关注模型规则的规避；它与外部网页、邮件或文档中隐藏指令的间接 Prompt Injection 入口不同。

### Indirect Prompt Injection / 间接提示注入

攻击者把恶意指令藏在 Agent 为正常任务读取的网页、邮件、代码、文档或 Tool Result 中，使模型把不可信数据误当成行动指令。开放内容 Agent 应假设这种输入可能进入 Context，并用来源标记、权限与隔离限制影响。

### Guardrail / 护栏

在 Agent 的输入、输出或 Tool 边界执行检查、变换、阻止或触发升级的机制。Guardrail 可以使用确定性规则或语义分类器，但它不是身份系统，也不能自动替代 Sandbox 与业务授权。

### Input Guardrail / 输入护栏

在初始用户输入进入 Agent 运行时检查范围、格式或风险的 Guardrail。它是否在模型调用开始前阻塞完成，取决于具体 SDK 的执行时序；它也不自动覆盖后续 Tool Result 中的间接注入。

### Output Guardrail / 输出护栏

在最终 Agent 输出交给用户或下游系统前执行的检查。它能过滤展示内容，却不能撤销此前已经发生的邮件发送、文件修改或其他 Tool 副作用。

### Tool Guardrail / 工具护栏

围绕单次 Tool 输入或输出执行的检查。Tool Input Guardrail 适合在副作用前校验参数、授权与批准；Tool Output Guardrail 适合裁剪或脱敏结果，但发生在执行之后。

### Authentication / 认证

验证请求者、用户或服务身份的过程，回答“你是谁”。认证成功只建立身份，不自动证明该主体能够操作任意资源。

### Authorization / 授权

根据已验证主体、资源、动作和条件判断请求是否允许的过程，回答“你可以对什么做什么”。授权应由宿主或业务服务执行，不能信任模型参数中的自报身份。

### Principal / 安全主体

权限系统中发起动作的已识别用户、服务、进程或 Agent 实例。Agent Tool 使用的 Principal 应从受信登录会话或运行身份绑定，而不是让模型在 Tool 参数中自由选择。

### Scope / 权限范围

凭证或授权允许执行的动作集合，例如只读日历或发送邮件。最小权限系统会为当前任务申请窄 Scope，并在更高风险动作前进行 Step-up。

### Audience / Resource / 令牌受众

访问 Token 被签发给哪个服务或资源使用的约束。Resource Server 应验证 Token 的受众；把给服务 A 的 Token 直接转交服务 B 会破坏边界。

### Consent / 用户同意

用户对一个具体主体、资源、动作、参数和时间范围作出的明确决定。Consent 不是永久权限，参数或目标改变后应重新执行策略，必要时重新批准。

### Confused Deputy / 混淆代理

高权限服务被较低权限请求者诱导，使用自己的权限完成请求者本不允许执行的动作。受众校验、资源级授权、最小 Scope 与不转交 Token 是常见防线。

### Tool Poisoning / 工具投毒

通过恶意 Tool Description、Schema、实现或结果影响模型选择和后续动作的供应链攻击。工具声明描述行为，却不能证明实现与权限安全；第三方 Tool 与 MCP Server 仍需来源、版本、权限和隔离审查。

### Data Exfiltration / 数据外传

敏感数据未经授权离开其允许边界的过程，例如被发送到外部收件人、网络目标、日志、Provider 或下游 Agent。控制点包括数据最小化、Tool 前置策略、凭证隔离、Egress 限制与结果脱敏。

### Audit Trail / 审计轨迹

能够重建一次动作由谁、在何时、依据哪版策略、对哪个资源、使用哪些规范化参数作出何种决定的结构化记录。审计应保存充分证据，同时避免把 Secret 和完整敏感内容复制进日志。

### Governance / 治理

规定风险由谁负责、策略怎样制定和评审、例外如何批准和过期、数据怎样留存删除、事故如何响应、系统怎样持续评估的组织与工程机制。Governance 让单个 Guardrail 进入可维护的生命周期。

### Policy Version / 策略版本

标识一次权限或风险决定所依据规则集合的稳定版本。Durable Run、Approval 与 Audit 记录 Policy Version，可以在规则更新后判断是否需要重新评估未完成动作。

### Incident Response / 事件响应

安全事件发生后用于检测、遏制、撤销凭证、停止运行、保存证据、确认副作用、通知相关方、修复并恢复服务的过程。Agent 系统还要处理结果未知的外部动作，不能把缺少 Tool Result 当成没有影响。

## 可观测性与评测

### Instrumentation / 仪表化

在模型请求、Tool 执行、重试、状态写入等代码边界产生结构化信号的过程。Instrumentation 是产生数据的手段，不等于系统已经具备关联、查询和解释未知问题的能力。

### Telemetry / 遥测

系统运行时发出的诊断数据，常见形式包括 Trace、Metric 和 Log。Telemetry 应保持被动，采集失败不能改变业务结果；它也不能代替 Durable State 与 Audit Trail。

### Observability / 可观测性

利用系统外部发出的信号理解内部状态、定位已知和未知问题的能力。高质量 Observability 需要稳定字段、关联 ID、时间边界、采集与查询机制，而不只是更多日志。

### Event / 事件

某个时刻发生的一件事，例如模型响应开始、Tool 执行结束或重试排队。Pi `AgentEvent` 首先是运行通知协议，只有被记录或转换后才会成为 Log、Trace Event 或 Metric 测量。

### Log / 日志

带时间与上下文字段的一条运行记录。结构化 Log 使用稳定 Schema 便于筛选与关联；写成 JSON 但字段含义不断变化，并不自动成为可靠的结构化日志。

### Metric / 指标

对多次运行测量并按时间或维度聚合的数值，例如任务成功率、P95 延迟、错误率和每成功任务成本。高基数 ID 不应随意成为 Metric 标签，否则会增加存储与聚合成本。

### Trace / 追踪

一次端到端操作中各段工作的父子和时间关系。Trace 适合定位模型、Tool、等待与重试的关键路径，但通常可采样、可脱敏，不等于完整 Session 或可恢复状态。

### Span / 追踪片段

Trace 中一段有开始和结束的操作。Span 通常包含名称、父 Span、时间、Attribute、Event 与 Status；子 Span 让一次 Agent Run 可以展开为 Turn、Model Request 和 Tool Execution。

### Correlation ID / 关联标识

把 Session、Run、Turn、Provider Request、Tool Call 和业务 Operation 的不同记录连接起来的稳定 ID。关联标识帮助还原证据，不会自动提供身份认证或授权。

### Trajectory / 行动轨迹

一次 Agent Trial 中按语义展开的消息、模型输出、Tool Call、Tool Result 和环境变化序列。Trajectory 适合评估动作路径；Trace 更强调时间与嵌套，两者可以共享数据但不能默认等同。

### Evaluation / Eval / 评测

向 AI 系统提供定义清楚的任务，并用预先规定的成功条件衡量结果与行为的过程。Eval 应保存任务、环境、模型、Harness、数据和 Grader 版本，避免用“感觉更好”代替比较。

### Task / Eval Case / 评测任务

带有输入、环境和成功条件的一道评测题。一个 Task 可以运行多次；任务本身与每次实际尝试不能混为一谈。

### Trial / 评测尝试

Agent 在指定配置和环境中执行某个 Task 的一次运行。模型输出具有变化时，同一 Task 的多个 Trial 用于观察成功概率与稳定性。

### Outcome / 最终环境结果

一次 Trial 结束后业务或执行环境中的真实状态，例如数据库是否存在预订、测试是否通过、目标文件是否正确。Assistant 声称完成不等于 Outcome 已达到。

### Grader / 评分器

依据成功标准对 Output、Trajectory 或 Outcome 给出分数、标签和理由的程序、人或模型。能用测试、Schema 和环境状态确定时，应优先使用确定性 Grader；模型 Grader 需要人工校准。

### LLM-as-a-Judge / 模型评分

让一个语言模型依据 Rubric 比较或评分其他模型输出的评测方式。它便于扩展语义评测，但可能存在位置、冗长、自增强、Rubric 漂移和提示注入偏差。

### Evaluation Harness / 评测运行框架

创建测试环境、运行 Agent、收集 Transcript 与 Artifact、执行 Grader 并汇总结果的基础设施。它与包围模型、实际承载 Agent 运行的 Agent Harness 解决不同问题。

### Eval Suite / 评测集

围绕某项能力、行为或风险组织的一组 Task。一个可靠 Suite 应包含常见、边界、历史失败和对抗场景，并保留未参与日常调试的测试数据。

### Baseline / Candidate / 基线与候选

比较实验中的现有配置与待验证配置。两者应运行在相同任务、重复次数和环境上，并尽量只改变一个主要因素，才能解释差异来自哪里。

### Harness Engineering

用观察、评测和反馈系统化改进模型之外的 Context、Tool、Loop、State、Policy、执行环境和验证机制的工程实践。它是仍在形成中的术语，不等同于 Pi `AgentHarness` 这个具体 API，也不只是 Prompt Engineering。

## 两个必须始终记住的边界

```text
保存了 Session ≠ 模型永久记住了历史
模型返回 Tool Call ≠ 工具已经执行
```

这两个边界能消除大量关于 “memory” 和 “autonomous action” 的误解。带着它们进入[第一章](../docs/01-from-llm-to-agent.md)。
