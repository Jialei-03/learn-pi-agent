# Learn Pi Agent 17｜为什么不能把模型当成权限系统

- 对应课程：第 17 章
- 核心问题：Prompt Injection、Guardrail、Approval 和 Sandbox 怎样组成真正的防线？
- 核心结论：模型输出只能是候选动作；身份、授权、批准和隔离必须由模型外的确定性系统执行，并用最小权限、来源追踪和治理闭环降低风险。
- 无声分镜基准：87 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 模型气泡被挡在权限门外 | ① |
| 06–15s | `02-model-output-is-not-authority.png` | 候选动作与授权决定分离 | ② |
| 15–24s | `03-indirect-prompt-injection.png` | 恶意指令从网页进入 Context | ③ |
| 24–33s | `04-security-control-layers.png` | AuthN、AuthZ、Gate、Sandbox、Audit 分层 | ④ |
| 33–42s | `05-guardrail-timing.png` | 输入、工具前、工具后、输出四个位置 | ⑤ |
| 42–51s | `06-least-privilege.png` | 能力按主体、资源、动作、时间收窄 | ⑥ |
| 51–60s | `07-tool-poisoning.png` | 恶意 Tool 描述和供应链入口标红 | ⑦ |
| 60–69s | `08-pi-security-boundaries.png` | Project Trust、Hook、无内置 Sandbox 边界 | ⑧ |
| 69–78s | `09-approval-exact-action.png` | 参数差异触发重新确认 | ⑨ |
| 78–87s | `10-governance-blueprint.png` | 预防、检测、响应、改进闭环 | ⑩ |

## 连续口播稿

① Agent 安全最重要的原则是：模型可以建议动作，却不能因为它说“有权限”，系统就授权。

② 身份来自认证，授权来自外部 Policy，批准来自真实负责人；模型输出始终只是候选动作。

③ Prompt Injection 也会从网页、邮件、仓库和 Tool Result 进入 Context，这就是间接注入。

④ Authentication、Authorization、Guardrail、Approval、Sandbox 和 Audit 分别负责身份、权限、检查、决定、隔离和证据。

⑤ Guardrail 的位置决定能力：Tool Guard 要在副作用前；Output Guardrail 无法撤销已发生的动作。

⑥ 最小权限限制主体、资源、动作、参数、时间和环境；凭证不进入模型 Context。

⑦ Tool、MCP、Skill 和 Extension 都是供应链入口，要固定版本并审查描述、代码和更新。

⑧ Pi Project Trust 控制扩展加载，不控制每个 Tool 权限；Hook 可做 Gate，但仍不是 OS Sandbox。

⑨ Approval 要展示真实动作和参数；参数变化后旧批准不能复用，滥用弹窗还会造成疲劳。

⑩ Governance 为规则定义 owner、版本、证据、例外和事故响应。下一章，用 Evaluation 判断系统有没有变好。

## 事实锚点

- System Prompt 不是权限系统，也不是可靠的安全隔离边界。
- Output Guardrail 不能撤销已经发生的外部副作用。
- Project Trust、Extension Hook 和 Sandbox 是三个不同机制。
