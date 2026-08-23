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

### Workflow / 工作流

由预先定义的步骤、连接规则、分支、循环和结束条件组成的任务控制过程。Workflow 的节点可以调用 LLM 或完整 Agent；只要候选路径和转移规则主要由程序拥有，整体仍然是 Workflow。

### Control Flow / 控制流

决定程序以什么顺序进入步骤、怎样分支或循环、何时结束的规则集合。分析 Workflow 与 Agent 时，最关键的问题是每一层的 Control Flow 由代码、模型还是人控制。

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

## 两个必须始终记住的边界

```text
保存了 Session ≠ 模型永久记住了历史
模型返回 Tool Call ≠ 工具已经执行
```

这两个边界能消除大量关于 “memory” 和 “autonomous action” 的误解。带着它们进入[第一章](../docs/01-from-llm-to-agent.md)。
