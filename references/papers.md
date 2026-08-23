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

### [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)

ReAct 把推理轨迹与环境动作交错起来，是理解 Agent Loop 的经典入口：模型提出下一步行动，环境返回观察，再继续决策。Pi 的具体事件与工具循环应以源码为准，而不是简单贴上 ReAct 标签。

## 三、工具使用：模型怎样选择外部能力

### [Toolformer: Language Models Can Teach Themselves to Use Tools](https://arxiv.org/abs/2302.04761)

Toolformer 研究模型如何学习何时以及怎样调用外部 API。它帮助区分“模型具有关于工具使用的生成能力”与“宿主提供、验证并执行工具”这两个层次。

### [Gorilla: Large Language Model Connected with Massive APIs](https://arxiv.org/abs/2305.15334)

Gorilla 关注大规模 API 选择与调用准确性，对理解工具描述、检索和参数生成很有价值。它也提醒我们：API 数量增加后，工具选择和接口漂移本身就成为系统问题。

## 四、运行控制：复杂循环怎样保持可解释的状态边界

### [Statecharts: A Visual Formalism for Complex Systems](https://doi.org/10.1016/0167-6423(87)90035-9)

Statecharts 在有限状态机之上组织层级、并发和事件，是理解复杂运行控制的经典工作。Pi 并没有直接声明一张 Statechart，但 agent、turn、message 与 tool 的层级事件，以及循环中的条件转移，可以借助状态机视角检查合法顺序和停止边界。

## 五、记忆与上下文：有限窗口怎样支撑长期任务

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

## 这些论文分别解释什么

- ReAct 为“推理—行动—观察”的 Agent Loop 提供研究背景；
- Toolformer 和 Gorilla 解释工具选择、工具描述与参数生成问题；
- Lost in the Middle 解释为什么长上下文装得下信息，却不代表模型能同等利用每个位置；
- SWE-bench 展示 coding agent 的完成结果如何放进真实软件工程任务中评测。

这些论文只提供问题背景和实验依据。论文方法是否出现在 Pi 中，仍然要由固定版本的源码证明。

## 与 Pi 源码怎样互相验证

- 论文给出一种问题定义或方法候选；
- API 文档规定当前可用的接口语义；
- Pi 源码展示这个项目在固定版本中的真实取舍；
- 实际运行和测试才说明某条路径在具体环境中怎样表现。

四者相互补充，没有任何一个可以单独替代其余三个。继续阅读：[Pi 源码地图](source-map.md)。
