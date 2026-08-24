# Learn Pi Agent 09｜Extension 怎样真正改变 Agent Harness

- 对应课程：第 9 章
- 核心问题：Extension、Plugin 和 Package 各自扩展了什么？
- 核心结论：Pi Extension 是运行时代码扩展；Package 是分发资源的单元；Plugin 是产品生态中的命名，不是跨平台统一协议。
- 无声分镜基准：87 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | Harness 外框出现多个插槽 | ① |
| 06–15s | `02-concept-position.png` | Extension、Skill、Package、Plugin 分层 | ② |
| 15–24s | `03-loading-and-trust.png` | 发现、信任、执行三步门控 | ③ |
| 24–33s | `04-registration-surfaces.png` | Tool、Command、Provider、UI 逐个注册 | ④ |
| 33–42s | `05-tool-vs-command.png` | 模型入口与用户入口分开 | ⑤ |
| 42–51s | `06-event-lifecycle.png` | Agent、Turn、Message 事件沿时间线出现 | ⑥ |
| 51–60s | `07-context-boundaries.png` | 四个 Context 修改点依次标出 | ⑦ |
| 60–69s | `08-tool-middleware.png` | `tool_call` 与 `tool_result` 夹住执行器 | ⑧ |
| 69–78s | `09-packages-and-plugins.png` | 本地、Git、npm 汇入 Package | ⑨ |
| 78–87s | `10-security-summary.png` | 供应链与运行权限同时上锁 | ⑩ |

## 连续口播稿

① 想给 Pi 增加 Tool、Command、Provider 或界面行为，靠 Prompt 不够，这时需要 Extension。

② Skill 是任务方法，Extension 是运行时代码，Package 负责分发资源；Plugin 的含义取决于具体产品。

③ Pi 可以发现 Extension，但项目级代码要经过信任边界才能执行。发现不等于授权。

④ Extension API 可注册 Tool、Command、Provider、UI 和事件处理器，因此能直接改变运行。

⑤ Tool 是模型请求的结构化动作；Command 是用户直接触发的入口，两者执行路径不同。

⑥ 生命周期事件覆盖 Agent、Turn、Message 和工具阶段；处理器加载顺序也会影响行为。

⑦ Context 可在输入、Agent 启动、模型调用和 Provider Payload 前修改；临时投影不等于 Session 历史。

⑧ `tool_call` 位于执行前，`tool_result` 位于执行后。它们构成工具中间件，但不是 Sandbox。

⑨ Pi Package 可来自本地、Git 或 npm，并携带多种资源；它不等于普通 npm 包或单个 Extension。

⑩ 扩展越强，供应链风险越大。版本、来源、权限和更新都要审查。下一章，区分 Workflow 与 Agent。

## 事实锚点

- 修改本轮 Context 投影不必然修改持久 Session。
- Extension Hook 可以控制调用链，但不提供操作系统级隔离。
- “Plugin”没有跨所有 Agent 产品一致的通用语义。
