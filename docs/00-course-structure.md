# 课程章节结构：以 Pi 为主线理解现代 Agent

章节按 Agent 的运行链路排列，从模型调用开始，逐步进入工具、上下文、协议、编排和真实环境中的工程问题；每组概念都放回 Pi 的工程结构中。

章节主线是：

```text
LLM API → Agent Loop → Tools → Context / Session
        → MCP / Skills / Extensions
        → Workflow / SDK / Multi-Agent
        → Sandbox / Security / Evaluation
        → Pi 源码与 Harness Engineering
```

## 一张总图

```mermaid
flowchart TB
    A["CLI / IDE / Web Application"] --> W["Workflow / Orchestrator"]
    W --> H["Agent Harness"]
    H --> R["Agent Runtime / Loop"]
    H --> C["Context / Session / Memory"]
    H --> T["Tools / MCP"]
    H --> S["Skills / Extensions / Packages"]
    H --> P["Policy / Sandbox / Human Approval"]
    H --> O["Events / Tracing / Evaluation"]
    R --> M["Model API / Provider"]
```

贯穿这些章节的工程视角是 `Harness`：它不是某一个 API，而是让模型能够持续完成任务的完整运行层，包括循环、上下文、工具、会话、策略、执行环境和反馈机制。Pi 官方仓库把 Pi 称为 Agent Harness，并将模型 API、Agent Runtime 与 coding agent 产品层拆成不同包；这为源码阅读提供了清晰主干。

## 第一部分：Agent 的核心运行机制

这一部分从 Agent 的核心运行机制开始，说明模型如何在宿主程序中变成一个可以行动的 Agent。

### 第 1 章：从 LLM 到 Agent，再到 Harness

建立 LLM、Agent、Runtime、Host、Environment 和 Harness 的边界，解释 Message、Context、State、Session、Tool Call 与 Agent Loop；同时用这些共同语义理解不同 API 的差异。

### 第 2 章：模型 API 与消息协议

比较 OpenAI Chat Completions、OpenAI Responses 和 Anthropic Messages，解释消息角色、内容块、Tool Call、Tool Result、Streaming、停止原因和 Provider 适配。

### 第 3 章：Agent Loop、状态机与停止条件

从第 1 章的教学循环进入 Pi 的真实源码，沿着 `AgentContext`、`AgentLoopConfig`、`runAgentLoop`、`runLoop` 和 `AgentEvent` 逐段阅读“准备 Context → 调用模型 → 处理响应 → 写回结果 → 继续或停止”，并区分模型的停止原因和 Runtime 对整段运行的控制。

### 第 4 章：Tools 与 Function Calling

继续阅读 Pi 的 `AgentTool`、参数校验、`executeToolCalls` 和 `ToolResultMessage`，再从 Tool Contract、Schema、Validation、Registry、Policy、Executor 和 Result 解释工具调用；补充并行调用、Tool Search、Toolformer 与 ReAct 的背景。

## 第二部分：上下文与能力接入

这一部分说明 Agent 能看到什么、能做什么，以及外部能力如何进入 Harness。

### 第 5 章：Context Engineering 与 Structured Output

解释 Prompt Engineering、Context Engineering、系统指令、项目上下文、动态上下文、token 预算、结构化输出与 Prompt Injection。`AGENTS.md`、`CLAUDE.md` 等项目指令会在这里作为 Harness 上下文的一部分出现。

### 第 6 章：Session、Memory、Retrieval 与 Compaction

区分 Context、Memory、Session、State、Checkpoint 和 Durable Execution；解释 RAG、消息树、分支、恢复、压缩以及长任务为什么需要持久化。

### 第 7 章：MCP：Agent 与外部世界的协议

讲清 MCP Host、Client、Server、JSON-RPC、能力发现、stdio、Streamable HTTP、Tools、Resources、Prompts，以及 Elicitation 与 Multi Round-Trip Requests。说明 2026 版协议为什么改为无状态请求，Roots、Sampling、Logging 为什么已进入弃用期；MCP 标准化外部能力接入，而不是 Agent 编排，Pi 可以通过 Extension 或 Package 把 MCP 接进自己的 Harness。

### 第 8 章：Skills 与 Prompt Templates

解释 Skill 与 Tool、MCP、System Instruction 和 Prompt Template 的区别；沿 Pi 源码追踪 Skill Catalog、`description` 路由、`read(SKILL.md)`、`/skill:name` 与 Prompt Template 参数展开。讲清渐进式披露、参考资料、脚本、资产、跨 Harness 可移植边界、安全审查与 Skill 评估，以及 Skill 如何指导 Agent 组合多个 Tool 或 MCP 能力。

### 第 9 章：Extensions、Plugins 与 Packages

解释 Pi 的扩展生命周期、自定义 Tool、Command、UI、事件处理、上下文注入、工具拦截和 Package 分发。这里把“协议是什么”与“Pi 如何接入协议”连接起来。

## 第三部分：Workflow 与 Agent 编排

这一部分说明一个任务由谁决定下一步，以及多个步骤或多个 Agent 如何协作。

### 第 10 章：Workflow 与 Agent 的区别

区分代码预先定义流程的 Workflow、由模型动态决定下一步的 Agent，以及两者结合的混合系统；介绍 deterministic orchestration 与 LLM-based orchestration。

### 第 11 章：Workflow Patterns

介绍 Prompt Chaining、Routing、Parallelization、Orchestrator-Workers、Evaluator-Optimizer 和带退出条件的循环，并说明 Structured Output 如何把模型判断交给代码执行。

### 第 12 章：Planning 与 Reasoning Patterns

介绍 ReAct、Plan-and-Execute、Reflection、Critic、Tree of Thoughts 和 Self-Consistency，区分显式计划、隐式计划与 Plan Mode。

### 第 13 章：Agent SDK 与应用集成

比较直接调用模型 API、使用 Agent Runtime、使用 Agent SDK 和使用 CLI 的差异；以 Pi SDK 和 OpenAI Agents SDK 说明 Session、事件、Streaming、自定义 UI 与自定义 Provider。

### 第 14 章：Multi-Agent 与 A2A

解释 Manager、Worker、Agents-as-Tools、Handoff、Delegation、上下文隔离和成本控制，再介绍 A2A 如何让不同框架或供应商的 Agent 发现能力、交换任务和协作。

## 第四部分：真实工程环境

这一部分说明 Agent 如何安全、可恢复、可观测地运行在真实环境中。

### 第 15 章：Sandbox、Code Agent 与 Computer Use

解释文件系统、Shell、代码执行、浏览器、Computer Use、工作目录、Sandbox、环境变量和 Secret 管理，明确“模型能请求”与“环境允许执行”的区别。

### 第 16 章：Durable Execution 与 Human-in-the-loop

解释 Background Agent、长时间任务、Checkpoint、Retry、Pause、Approval、Reject 和 Resume；把人工批准作为 Workflow 的控制流，而不只是安全弹窗。

### 第 17 章：Security、Guardrails 与 Governance

介绍 Input、Output 和 Tool Guardrail，权限、策略、最小权限、Prompt Injection、Tool Poisoning、数据泄漏、审计和用户同意。

### 第 18 章：Observability、Evaluation 与 Harness Engineering

介绍 Agent Event、Lifecycle Hook、Trace、Token、延迟、成本、Task Success、Trajectory Evaluation、LLM-as-a-Judge 和回归测试，并用 Harness Engineering 总结如何通过工具、约束、测试和反馈提升可靠性。

## Pi 源码如何进入这条主线

源码阅读不单独制造一条平行路线，而是跟随章节逐步进入：

```text
第 2 章 → pi-ai：Provider、Message、Content、Stream
第 3 章 → pi-agent-core：AgentContext、AgentLoopConfig、runAgentLoop、runLoop、AgentEvent
第 4 章 → pi-agent-core：AgentTool、executeToolCalls、ToolResultMessage
第 6～9 章 → coding-agent：Session、Resource、Skill、Extension、Package
第 13～18 章 → SDK、Sandbox、Telemetry、Evaluation 与完整运行链路
```

最终目标不是记住所有术语，而是能从一次用户输入出发，解释它如何经过 Provider、Context、Agent Loop、Tool/MCP、Session、Event 和 UI，最后得到响应或进入下一轮。
