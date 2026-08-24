# Learn Pi Agent 08｜Skill 不是 Tool：它教 Agent 怎么做事

- 对应课程：第 8 章
- 核心问题：Skill、Tool、MCP 和 Prompt Template 为什么不能混用？
- 核心结论：Skill 是可发现、按需加载的任务方法；Tool 提供动作，MCP 提供连接协议，Prompt Template 提供可展开文本。
- 无声分镜基准：87 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | Mox 打开一本 Skill 手册 | ① |
| 06–15s | `02-skill-position.png` | Skill、Tool、MCP 在不同层归位 | ② |
| 15–24s | `03-skill-anatomy.png` | `SKILL.md`、references、scripts、assets 展开 | ③ |
| 24–33s | `04-description-routing.png` | description 先参与匹配 | ④ |
| 33–42s | `05-progressive-disclosure.png` | 目录→正文→资源逐层加载 | ⑤ |
| 42–51s | `06-pi-loading.png` | Pi 扫描路径并建立 Catalog | ⑥ |
| 51–60s | `07-two-activation-paths.png` | 自动选择与显式 `/skill` 分路 | ⑦ |
| 60–69s | `08-prompt-template.png` | 参数填入模板后展开 | ⑧ |
| 69–78s | `09-skill-vs-template.png` | 方法包与一次性文本对照 | ⑨ |
| 78–87s | `10-security-summary.png` | 代码、资产和说明分别审查 | ⑩ |

## 连续口播稿

① Agent 已经有 Tool，为什么还需要 Skill？因为“能做什么”和“应该怎样做”是两个问题。

② Tool 提供动作，MCP 规定连接，System Instruction 给全局规则；Skill 保存一类任务的方法和资源。

③ Skill 以 `SKILL.md` 为入口，还可附带 references、scripts 和 assets，分别提供知识、操作和素材。

④ Pi 先读取名称和 description 建立 Catalog。description 是路由条件，要说清何时使用、解决什么问题。

⑤ 命中任务后才读取完整说明，再按需打开资料或脚本。这就是渐进式披露：用较少 Context 暴露较多能力。

⑥ Pi 从用户级和项目级位置发现 Skill，校验入口、处理重名，再建立可用目录。

⑦ Skill 可由 Agent 自动选择，也可由用户用 `/skill:name` 显式调用。被发现不等于被执行。

⑧ Prompt Template 是带参数的文本片段；它通常没有 Skill 的路由、脚本、资产和完整方法。

⑨ Template 适合重复表达请求；Skill 适合沉淀可靠做法，并协调多个 Tool 或 MCP 能力。

⑩ Skill 脚本仍是代码，安装前要审查，运行时保留权限边界。下一章，看 Extension 怎样改变 Harness。

## 事实锚点

- Skill 的说明文本会影响 Agent 行为，但它本身不提供新的系统权限。
- 渐进式披露是减少初始 Context 占用，不表示后续资源天然可信。
- Prompt Template 展开文本；Skill 可以包含方法、资源和可执行脚本。
