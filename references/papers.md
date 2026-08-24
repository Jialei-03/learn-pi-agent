# 论文阅读索引

这里按学习问题组织论文，而不是按年份堆成“必读榜单”。每篇只说明它为什么与本仓库有关；论文中的方法、实验设置和局限需要回到原文判断。

> 重要：这些论文构成 Agent 领域的研究背景，不代表 Pi 一定直接采用了每篇论文的方法。本仓库会在有源码证据时明确写“Pi 如何实现”，没有证据时只说“这个研究帮助我们理解某类问题”。

## 一、基础模型：为什么语言模型能成为 Agent 的决策组件

### [Attention Is All You Need](https://arxiv.org/abs/1706.03762)

Transformer 奠定了现代大语言模型的重要架构基础。阅读本仓库不需要先推导全部公式，但理解注意力处理 token 间关系，有助于认识上下文是一段有限输入，而不是无限、无损的记忆。

### [Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165)

GPT-3 展示了大规模语言模型通过上下文示例完成多种任务的能力。它与 Agent 的联系在于：宿主可以用提示和历史引导模型，但“能根据上下文生成”仍不等于拥有工具权限或长期状态。

### [Training Language Models to Follow Instructions with Human Feedback](https://arxiv.org/abs/2203.02155)

常称 InstructGPT，讨论如何让模型更好地遵循用户意图。它帮助解释为什么指令模型适合成为交互组件，也提醒我们“更会遵循”是一种训练目标，不是可靠执行所有复杂任务的保证。

## 二、推理与行动：从生成答案到交替观察环境

### [Chain-of-Thought Prompting Elicits Reasoning in Large Language Models](https://arxiv.org/abs/2201.11903)

Chain-of-Thought 研究提示中间推理步骤对部分任务的作用。它与 Agent 的关系主要在“多步决策”，但不要把可见推理文本等同于模型真实、完整或可靠的内部过程。

### [Language Models Don't Always Say What They Think: Unfaithful Explanations in Chain-of-Thought Prompting](https://arxiv.org/abs/2305.04388)

这项研究展示可见 Chain-of-Thought 可能对影响答案的提示因素保持沉默，因此“解释听起来合理”不能单独证明它忠实反映模型的实际决策过程。Agent 工程应同时保存 Tool Call、Tool Result、测试、来源与审批等外部证据。

### [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)

ReAct 把推理轨迹与环境动作交错起来，是理解 Agent Loop 的经典入口：模型提出下一步行动，环境返回观察，再继续决策。Pi 的具体事件与工具循环应以源码为准，而不是简单贴上 ReAct 标签。

### [Plan-and-Solve Prompting: Improving Zero-Shot Chain-of-Thought Reasoning by Large Language Models](https://arxiv.org/abs/2305.04091)

Plan-and-Solve 让模型先制定解题方案，再按方案完成推导。它提供“先计划、后求解”的提示研究背景，但发生在一次回答内部的计划式提示，不等于 Agent Harness 已经实现可校验、可恢复的 Plan-and-Execute 控制结构。

### [Self-Consistency Improves Chain of Thought Reasoning in Language Models](https://arxiv.org/abs/2203.11171)

Self-Consistency 对同一问题采样多条推理路径，再按最终答案的一致性聚合。它与并行投票具有相似控制流，但依赖答案可规范化、样本确有差异和错误不过度相关；多次采样也会近似成比例增加模型调用成本。

### [Tree of Thoughts: Deliberate Problem Solving with Large Language Models](https://arxiv.org/abs/2305.10601)

Tree of Thoughts 把中间候选表示成可扩展、可评价和可回溯的搜索状态。真正的 ToT 需要外部控制器保存树、frontier、评分、剪枝与预算；让模型列出几个方案并不自动形成搜索算法。

### [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)

Reflexion 把语言形式的反思写入 episodic memory，让后续 trial 能利用过去反馈，而不是通过梯度更新模型权重。工程实现还要验证反思、限定作用域并处理过期和错误记忆。

## 三、工具使用：模型怎样选择外部能力

### [Toolformer: Language Models Can Teach Themselves to Use Tools](https://arxiv.org/abs/2302.04761)

Toolformer 研究模型如何学习何时以及怎样调用外部 API。它帮助区分“模型具有关于工具使用的生成能力”与“宿主提供、验证并执行工具”这两个层次。

### [Gorilla: Large Language Model Connected with Massive APIs](https://arxiv.org/abs/2305.15334)

Gorilla 关注大规模 API 选择与调用准确性，对理解工具描述、检索和参数生成很有价值。它也提醒我们：API 数量增加后，工具选择和接口漂移本身就成为系统问题。

## 四、运行控制：复杂循环怎样保持可解释的状态边界

### [Statecharts: A Visual Formalism for Complex Systems](https://doi.org/10.1016/0167-6423%2887%2990035-9)

Statecharts 在有限状态机之上组织层级、并发和事件，是理解复杂运行控制的经典工作。Pi 并没有直接声明一张 Statechart，但 agent、turn、message 与 tool 的层级事件，以及循环中的条件转移，可以借助状态机视角检查合法顺序和停止边界。

### [Self-Refine: Iterative Refinement with Self-Feedback](https://arxiv.org/abs/2303.17651)

Self-Refine 研究模型怎样根据自己产生的反馈迭代修改输出，为理解 Evaluator-Optimizer 提供实验背景。论文展示的是特定任务和设置中的改进可能性；工程系统仍要明确评价标准、外部证据、最大次数、最佳候选与失败状态，不能把“重复自评”当成必然收敛。

## 五、记忆与上下文：有限窗口怎样支撑长期任务

### [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401)

RAG 把参数化生成模型与可检索的非参数化知识源结合，是理解“先找证据，再把证据放进 Context”的经典工作。工程系统还要单独评估召回、排序、证据新鲜度与生成忠实度，不能把 RAG 简化成“接入向量数据库后不再幻觉”。

### [Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427)

CoALA 用 working memory、长期 procedural / semantic / episodic memory、内部与外部动作以及决策循环组织 Language Agent。它为区分 Context、经历、事实和行为规则提供了一套研究框架；这些分类是分析工具，不代表 Pi 必须实现同名组件。

### [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442)

论文用记忆流、反思和计划支撑长期行为，适合帮助区分原始经历、检索结果与高层摘要。它是理解 Agent memory 设计空间的案例，不代表所有 coding agent 都需要模拟相同结构。

### [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172)

研究表明长上下文中的信息位置会影响模型利用效果。它解释了为什么“窗口装得下”不等于“模型同等可靠地使用每段信息”，也是讨论上下文选择与 compaction 的重要背景。

### [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560)

MemGPT 用分层存储和显式管理类比操作系统的内存层次，帮助理解如何在有限上下文外维护长期信息。阅读时应区分论文架构、产品实现和 Pi 自己的 Session/compaction 机制。

### [LongLLMLingua: Accelerating and Enhancing LLMs in Long Context Scenarios via Prompt Compression](https://arxiv.org/abs/2310.06839)

LongLLMLingua 研究长上下文提示压缩，提示我们压缩不仅是“把字数变短”，还涉及哪些 token 被保留以及性能如何评估。Pi 的 compaction 是否采用同类方法必须由源码证据回答。

## 六、上下文信任：模型怎样处理互相冲突的指令

### [Not what you've signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection](https://arxiv.org/abs/2302.12173)

这项工作系统讨论间接 Prompt Injection：攻击文字不一定由用户直接输入，也可能藏在 Agent 将要检索的网页、邮件或其他外部数据中。它帮助理解为什么“检索到的信息”不能自动获得“可执行指令”的信任级别。

### [The Instruction Hierarchy: Training LLMs to Prioritize Privileged Instructions](https://arxiv.org/abs/2404.13208)

论文研究如何让模型按权限层级处理系统、用户与第三方内容中的冲突指令。Instruction Hierarchy 能提升模型抵抗提示注入的能力，但不能取代宿主的最小权限、Tool Policy、审批与 Sandbox。

## 七、评测：怎样判断 Agent 真的能完成任务

### [AgentBench: Evaluating LLMs as Agents](https://arxiv.org/abs/2308.03688)

AgentBench 在多种交互环境中评测作为 Agent 的模型，适合认识评测需要覆盖多轮决策与环境反馈。总分不能自动解释失败来自模型、工具、环境还是循环控制。

### [SWE-bench: Can Language Models Resolve Real-World GitHub Issues?](https://arxiv.org/abs/2310.06770)

SWE-bench 使用真实 GitHub issue 与代码仓库评估软件工程能力，与 coding agent 直接相关。阅读成绩时要同时检查数据版本、运行环境、工具、通过标准与是否存在数据污染风险。

### [Holistic Evaluation of Language Models](https://arxiv.org/abs/2211.09110)

HELM 在统一场景中同时考察准确性、校准、鲁棒性、公平性、偏差、毒性与效率，说明模型与 Agent 质量不能只剩一个总分。多指标公开报告能让能力、风险与成本之间的权衡保持可见。

### [τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045)

τ-bench 让 Agent 在领域政策约束下与模拟用户和 API Tool 多轮交互，并用最终数据库状态判定 Outcome。它提出 `pass^k` 观察多次 Trial 全部成功的可靠性，帮助区分“偶尔成功”和“连续使用仍稳定”。

### [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685)

这项工作研究用强模型扩展开放式回答评测，并系统分析 Position、Verbosity、Self-enhancement 和推理能力偏差。LLM-as-a-Judge 可以降低大规模语义评分成本，但需要清晰 Rubric、顺序控制和人工标签校准。

### [AI Harness Engineering: A Runtime Substrate for Foundation-Model Software Agents](https://arxiv.org/abs/2605.13357)

这项 2026 年工作把软件 Agent 视为 Model、Harness 与 Environment 的共同系统，并整理任务规范、Context、Tool、Memory、State、Observability、失败归因、验证、权限与干预记录等 Harness 职责。Harness Engineering 仍是新近形成的研究与工程术语，应用它时需要明确具体系统边界，而不是把名称当成统一标准。

## 八、Agent 与计算机接口：模型怎样在真实环境里完成动作

### [SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/abs/2405.15793)

SWE-agent 把文件导航、编辑、命令执行和反馈组织成专为模型设计的 Agent-Computer Interface，并研究接口设计怎样影响真实软件工程任务表现。它帮助理解 Code Agent 的能力来自模型、接口、执行环境和反馈循环的共同作用，而不是单靠一段更长的提示。

### [WebArena: A Realistic Web Environment for Building Autonomous Agents](https://arxiv.org/abs/2307.13854)

WebArena 提供可复现的真实功能网站与长链路任务，并按最终功能状态评估 Web Agent。它说明网页 Agent 的正确性应由环境结果验证，页面内容同时也是可能影响模型判断的不可信输入。

### [OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer Environments](https://arxiv.org/abs/2404.07972)

OSWorld 在真实操作系统和跨应用任务中评测多模态 Agent，覆盖截图观察、鼠标键盘操作、文件 I/O 与多应用流程。它为 Computer Use 的视觉定位、环境稳定性、长程控制和执行式评测提供研究背景。

## 九、持久化与人工控制：长任务中断后怎样继续

### [Sagas](https://sigmodrecord.org/1987/12/09/sagas/)

Sagas 把长事务拆成一系列可独立提交的子事务，并为已经完成的步骤定义补偿。它为跨模型、文件、消息和业务系统的 Agent Workflow 提供一个经典边界：无法原子回滚的外部动作，需要明确补偿、审计与人工升级路径。

### [Durable Functions: Semantics for Stateful Serverless](https://www.microsoft.com/en-us/research/wp-content/uploads/2021/10/DF-Semantics-Final.pdf)

这项工作形式化说明 record-and-replay 运行时怎样保存 Workflow 进度，以及确定性编排为什么能从历史中恢复。它帮助区分可重放的控制逻辑与必须隔离成 Effect / Activity 的模型调用、网络请求和其他外部动作。

### [Netherite: Efficient Execution of Serverless Workflows](https://www.microsoft.com/en-us/research/publication/netherite-efficient-execution-of-serverless-workflows/)

Netherite 研究持久化 Workflow 的分区、流水线和 group commit，展示可靠恢复背后的 I/O、历史大小、吞吐与延迟成本。Checkpoint 越细并不总是越好，粒度需要同时满足恢复语义和性能目标。

### [Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)

这项 CHI 2019 工作提出并验证 18 条 Human-AI Interaction 指南，包括说明能力边界、支持纠正、提供适当控制和帮助用户从失败中恢复。把 HITL 落到 Agent 工程时，批准界面之外还要保存具体动作、决定者、版本、超时、重新校验与恢复路径。

## 十、安全：开放内容和高权限工具怎样形成攻击链

### [InjecAgent: Benchmarking Indirect Prompt Injections in Tool-Integrated Large Language Model Agents](https://arxiv.org/abs/2403.02691)

InjecAgent 把正常用户任务、攻击目标、工具和恶意外部内容组合成间接 Prompt Injection 基准。它把评测重点从“模型能否识别恶意句子”推进到“恶意内容能否改变真实 Tool 轨迹”。

### [AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents](https://arxiv.org/abs/2406.13352)

AgentDojo 在动态工具环境中同时评估正常任务效用与注入攻击成功率。它提醒安全评测不能靠拒绝所有动作取得漂亮数字，而要显式观察 Utility、攻击成功、误拒绝与防御代价。

### [ToolEmu: Identifying the Risks of LM Agents with an LM-Emulated Sandbox](https://arxiv.org/abs/2309.15817)

ToolEmu 用语言模型模拟 Tool 与风险场景，检查 Agent 的中间动作和潜在副作用。模拟能扩充难以安全执行的测试覆盖，但仍需与真实授权、Sandbox 集成测试和生产监测结合。

## 这些论文分别解释什么

- ReAct 为“推理—行动—观察”的 Agent Loop 提供研究背景；
- Plan-and-Solve、Self-Consistency 与 Tree of Thoughts 分别提供计划式提示、多路径聚合和显式搜索的研究背景；
- Self-Refine 与 Reflexion 帮助区分当前任务内的迭代修改和跨 trial 保存的语言反思；
- Toolformer 和 Gorilla 解释工具选择、工具描述与参数生成问题；
- RAG 解释外部证据怎样通过检索重新进入生成过程；
- CoALA 与 MemGPT 提供区分工作上下文、长期记忆和分层存储的研究视角；
- Lost in the Middle 解释为什么长上下文装得下信息，却不代表模型能同等利用每个位置；
- SWE-bench 展示 coding agent 的完成结果如何放进真实软件工程任务中评测；
- HELM 说明评测应保留质量、风险与效率的多维结果，而不是只看一个总分；
- τ-bench 通过环境 Outcome 与 `pass^k` 强调 Tool Agent 的连续可靠性；
- LLM-as-a-Judge 研究说明模型评分可扩展，但必须处理位置、长度和自增强偏差；
- AI Harness Engineering 把 Context、Tool、State、验证与可观测性整理为模型之外的系统改进对象；
- SWE-agent 说明 Agent-Computer Interface 的设计会改变模型能否有效阅读、修改和验证代码；
- WebArena 与 OSWorld 分别把 Web Agent 和 Computer-Using Agent 放进可执行环境中评测。
- Sagas、Durable Functions 与 Netherite 分别解释补偿、确定性重放和持久化运行成本；
- Human-AI Interaction 指南帮助把人工控制从一个弹窗扩展成可理解、可纠正、可恢复的运行过程；
- Indirect Prompt Injection、InjecAgent、AgentDojo 与 ToolEmu 分别建立外部内容攻击、工具型基准、效用—安全联合评估与模拟风险测试的研究背景。

这些论文只提供问题背景和实验依据。论文方法是否出现在 Pi 中，仍然要由固定版本的源码证明。

## 与 Pi 源码怎样互相验证

- 论文给出一种问题定义或方法候选；
- API 文档规定当前可用的接口语义；
- Pi 源码展示这个项目在固定版本中的真实取舍；
- 实际运行和测试才说明某条路径在具体环境中怎样表现。

四者相互补充，没有任何一个可以单独替代其余三个。继续阅读：[Pi 源码地图](source-map.md)。
