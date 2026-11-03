---
motto: 能力可以有一百种，上下文里只放一份目录。
learn:
  - Skill 是什么：一个带说明书的目录；它和工具、AGENTS.md、扩展、MCP 分别解决什么问题
  - 渐进式披露的三层：目录始终在场，正文按需读取，附带文件用到才碰
  - Pi 怎样发现、校验、列出 Skill，以及为什么它没有专门的 Skill 工具
  - 提示模板：一个 Markdown 文件就是一个斜杠命令，参数怎样替换
  - Skill 也是注入面：装一个 Skill，等于让陌生人给你的 Agent 写说明书
prereq: 第 5、6、9 章
time: 50 分钟
build: mox/src/skills.ts（Skills 与提示模板，接入 mox 命令行）
---

## 一个 Agent 要会多少事

你希望 Agent 会写符合团队规范的发布说明、会按公司流程做数据库迁移、会用某个内部库处理 PDF、会按设计系统写前端组件……这些知识放在哪里？

- **全写进 AGENTS.md 或系统提示**：每次请求都带着它们。二十个流程、每个两千字，系统提示就多了四万字——大部分与当前任务无关，既花钱，也分散模型的注意力（第 6 章说过，上下文不是越多越好）。
- **每个流程写一个工具**：工具是代码，要实现、要维护；而大多数流程本质上只是“一份说明，加几个现成的脚本”。

Skill 是两者之间的答案：**把一类工作需要的说明、参考资料和脚本放在一个目录里，平时只让模型知道它存在，用到时再读。**

| 机制 | 是什么 | 谁决定何时进入上下文 | 适合 |
| --- | --- | --- | --- |
| 工具（第 4、5 章） | 代码，模型调用后执行 | 定义始终在场 | 需要执行的原子操作 |
| AGENTS.md（第 6 章） | 人写的项目约定 | 始终在场 | 每个任务都该知道的事 |
| **Skill** | 说明书 + 参考资料 + 脚本 | **模型按描述判断**，或用户 `/skill:名字` | 某一类工作的专门知识 |
| 提示模板 | 带参数的文本宏 | 用户输入 `/名字` | 反复要打的同一段话 |
| 扩展（第 9 章） | 运行在 Agent 进程里的代码 | — | 改变 Agent 本身的行为 |
| MCP（第 12 章） | 外部进程提供的工具 | 定义始终在场 | 连接外部系统 |

## Skill 长什么样

一个 Skill 就是一个目录，里面必须有 `SKILL.md`。这是 [Agent Skills 规范](https://agentskills.io/specification) 定义的格式，Pi 和 Claude Code 都采用它，所以同一个 Skill 目录可以在不同的 Agent 之间复用。本章实验用的一个 Skill：

```text
release-notes/
├── SKILL.md
└── references/
    └── style.md
```

```markdown
---
name: release-notes
description: 根据 git 提交记录写发布说明。用户要求写 changelog、发布说明、版本说明时使用。
---

# 写发布说明

1. 运行 `git log --oneline <上一个标签>..HEAD` 收集提交。
2. 按 references/style.md 的规范分组：新功能、修复、破坏性改动。
3. 每条说明写给用户看，不要照抄提交信息。
```

开头的元信息里，`name` 和 `description` 是核心。规范要求：`name` 只能用小写字母、数字和连字符（不能以连字符开头或结尾，不能连续两个），最长 64 个字符；`description` 必填，最长 1024 个字符。正文就是给模型看的说明，里面提到的相对路径以 `SKILL.md` 所在目录为基准。

## 渐进式披露

Skill 的核心思想叫**渐进式披露**（progressive disclosure）：信息分层，只在需要时展开下一层。

<figure class="diagram">
<svg viewBox="0 0 720 190" role="img" aria-label="渐进式披露的三层">
<g font-size="12">
<text x="20" y="22" font-weight="700" fill="var(--muted)">内容</text>
<text x="470" y="22" font-weight="700" fill="var(--muted)">什么时候进入上下文</text>
<rect x="20" y="34" width="120" height="40" rx="6" fill="var(--accent-soft)" stroke="var(--accent)"/>
<text x="32" y="52" font-weight="700" fill="var(--accent-ink)">① 目录</text>
<text x="32" y="67" font-size="11" fill="var(--accent-ink)">名字 + 描述 + 位置</text>
<text x="470" y="52" fill="var(--ink)">始终在系统提示里</text>
<text x="470" y="67" font-size="11" fill="var(--faint)">每个 Skill 几十个 token</text>
<rect x="20" y="84" width="260" height="40" rx="6" fill="var(--bg)" stroke="var(--line-2)"/>
<text x="32" y="102" font-weight="700" fill="var(--ink)">② SKILL.md 正文</text>
<text x="32" y="117" font-size="11" fill="var(--muted)">步骤、约定、注意事项</text>
<text x="470" y="102" fill="var(--ink)">任务与描述相符时，模型用 read 读取</text>
<text x="470" y="117" font-size="11" fill="var(--faint)">通常几百到几千 token</text>
<rect x="20" y="134" width="430" height="40" rx="6" fill="var(--bg-soft)" stroke="var(--line-2)" stroke-dasharray="4 3"/>
<text x="32" y="152" font-weight="700" fill="var(--ink)">③ 附带文件</text>
<text x="32" y="167" font-size="11" fill="var(--muted)">references/ 参考资料 · scripts/ 脚本 · assets/ 模板</text>
<text x="470" y="152" fill="var(--ink)">正文指向它们、任务需要时才读</text>
<text x="470" y="167" font-size="11" fill="var(--faint)">脚本只执行，只有输出进入上下文</text>
</g>
</svg>
<figcaption>越往下内容越多，进入上下文的门槛也越高。装一百个 Skill，平时的成本也只是一百行目录。</figcaption>
</figure>

第一层是 Pi 写进系统提示的内容：

@pi packages/coding-agent/src/core/skills.ts#formatSkillsForPrompt

几个值得注意的细节：

- **Pi 没有专门的 Skill 工具。** 提示里直接告诉模型“用 read 工具读取 Skill 的文件”。读取 Skill 和读取任何源文件走的是同一个工具，Agent 不需要为 Skill 增加任何新机制。
- **标了 `disable-model-invocation` 的 Skill 不进目录**，模型根本不知道它们存在，只能由用户显式调用（下文）。
- **描述经过 XML 转义。** 描述来自 Skill 作者，如果原样拼进提示，一个包含 `</available_skills>` 的描述就能“关闭”目录、在后面写入任意内容。转义让描述只能是数据。

既然依赖 read 工具，没有它会怎样？Pi 组装系统提示时会检查：

@pi packages/coding-agent/src/core/system-prompt.ts#L174-L181

有 read 就提示用 read；只有 bash 就提示用 bash（`cat` 也能读文件）；两者都不可用，Skills 小节就不出现——列出一个模型无法打开的目录没有意义。

这个实验用 Pi 的脚本模型模拟一次完整的使用过程：模型先看到目录，判断任务匹配，读取 `SKILL.md`，再按正文的指引读取参考资料：

@lab node labs/ch11/progressive.ts

目录只有几百个字符。正文在第 2 次请求前才进入上下文，参考资料在第 3 次请求前才进入；没用到的 Skill，正文一个字都没进来。

::: predict 描述写成“处理发布相关的事情”会怎样？
???
模型只能根据描述判断要不要读取一个 Skill，描述就是它的“路由规则”。“处理发布相关的事情”太模糊：用户说“写个 changelog”时，模型未必能把它和这个 Skill 联系起来；用户问“发布流水线为什么挂了”时，又可能误读进来。好的描述同时写清**做什么**和**什么时候用**，并包含用户可能用到的说法：“根据 git 提交记录写发布说明。用户要求写 changelog、发布说明、版本说明时使用。”Pi 的文档专门举了一个反例：“Helps with PDFs”。
:::

## 发现、校验与冲突

Pi 从几个位置寻找 Skill：用户目录 `~/.pi/agent/skills/`、项目目录 `.pi/skills/`，以及 Agent Skills 规范约定的 `~/.agents/skills/` 和 `.agents/skills/`（项目里的会从当前目录一直向上找到仓库根目录）。和第 9 章的项目扩展一样，**项目里的 Skill 需要先信任项目才会加载**。

同一组目录，mox 和 Pi 各自加载一遍：

@lab node labs/ch11/skills.ts

逐项看：

- **`Bad_Name`** 不符合命名规范，但仍然被加载，只给出警告。Pi 对大多数格式问题都这样处理：Skill 多半是从别处拿来的，一个格式瑕疵不该让整个 Agent 启动失败。
- **`broken`** 没有描述，不加载。没有描述，模型就无从判断什么时候该用它，加载了也只是占位置。
- **两个 `release-notes`** 重名，保留先发现的那个。目录的扫描顺序就是优先级。
- **`release-notes/examples/demo/SKILL.md`** 没有被当成独立的 Skill。一个目录里有 `SKILL.md`，它就是一个 Skill 的根，不再往下找：

@pi packages/coding-agent/src/core/skills.ts#L192-L221

没有这条规则，一个“教你写 Skill”的 Skill 里自带的示例，就会变成一个真的 Skill。（mox 一开始就漏了这一点，写这一章的实验时才发现。）

## /skill:名字：让用户说了算

模型不一定会想到去读某个 Skill，有些 Skill 也不应该由模型自己决定什么时候用——部署、数据库迁移、发邮件这类有副作用的流程，时机应该由人决定。这两种情况都用显式调用：`/skill:名字 参数`。

@pi packages/coding-agent/src/core/agent-session.ts#L2232-L2255

做法很直接：去掉元信息，把正文包在 `<skill>` 标签里，注明基准目录，参数附在后面，整体作为**用户消息**发出。上面实验的后半段就是 `/skill:db-migration` 展开后的样子；这个 Skill 标了 `disable-model-invocation`，所以它不在目录里，只能这样调用。

展开发生在什么时候？

@pi packages/coding-agent/src/core/agent-session.ts#L2150-L2155

先展开 Skill，再展开提示模板。这段代码之前，扩展的 `input` 事件（第 9 章）已经处理过输入，所以扩展看到的是用户输入的原文 `/skill:...`，可以在展开之前拦截或改写它。

::: insight 展开后的 Skill 是一条普通的用户消息
它会被写进会话文件，也会参与压缩。长任务中途压缩时，摘要可能只剩一句“用户调用了 db-migration”，Skill 的具体步骤就丢了。Claude Code 对此有专门的处理：压缩后重新附上本会话调用过的 Skill（每个最多保留开头 5000 个 token，总共不超过 25000 个，优先保留最近调用的）。Pi 依靠模型在需要时重新读取文件。
:::

## 提示模板：一个文件就是一个命令

Skill 是给模型的说明书；**提示模板**简单得多：它是给用户自己用的文本宏。在 `~/.pi/agent/prompts/`（或信任后的项目 `.pi/prompts/`）放一个 `review.md`，就有了 `/review` 命令：

```markdown
---
description: 审查暂存区的改动
---
审查 git 暂存区的改动，重点关注 ${1:-正确性、安全和错误处理}。
涉及的文件：${@:2}
```

参数替换的写法借鉴了 shell：

@pi packages/coding-agent/src/core/prompt-templates.ts#L62-L108

`$1` 是第一个参数（和 shell 一样从 1 开始），`$@` 是全部参数，`${1:-默认值}` 在没给参数时使用默认值，`${@:2}` 是从第 2 个开始的全部参数。注释里还有一句重要的说明：**替换只做一遍**。参数里如果包含 `$1` 之类的文字，不会被再次替换——否则用户输入的内容就能操纵模板的展开结果，展开也可能永远不停。

三种输入，mox 和 Pi 的展开结果：

@lab node labs/ch11/templates.ts

参数按 shell 的规则切分，所以 `"并发与锁"` 是一个参数。

模板和 Skill 的区别：模板只能由用户触发，没有附带文件，展开后就是一段普通文字；Skill 可以被模型自己发现和使用。一个经验法则：**如果你希望模型在合适的时候自己想到它，写成 Skill；如果只是你自己懒得重复打字，写成模板。**

## mox 的实现

`mox/src/skills.ts` 不到一百二十行，覆盖了上面所有行为。加载：

@code mox/src/skills.ts#loadSkills collapse=true

进入系统提示的目录：mox 用简单的列表代替 XML，同样过滤掉仅限手动调用的 Skill：

@code mox/src/skills.ts#formatSkillsIndex

接入命令行时，Skill 目录作为系统提示的一个小节（第 6 章的 `buildPromptSections`）；项目里的 Skill 和模板与项目扩展一样，需要 `--trust`：

@code mox/src/cli.ts#region:skills

用户输入先展开 `/skill:名字`，再展开模板，顺序与 Pi 一致：

@code mox/src/cli.ts#region:expand

把本章实验的 `release-notes` 目录复制到 `~/.mox/skills/` 下，用真实模型试试“帮我写这个版本的发布说明”，观察它是否先 `read` 了 `SKILL.md`。

::: compare Claude Code 的 Skills
Claude Code 同样使用 `SKILL.md` 格式（`~/.claude/skills/`、项目的 `.claude/skills/`），但有几处不同的设计（[官方文档](https://code.claude.com/docs/en/skills)）：

- **专门的 Skill 工具**：模型通过调用 Skill 工具来加载，而不是读文件。好处是“使用了哪个 Skill”成为一个明确的事件，可以被权限规则（`Skill(名字)`）、钩子和统计识别；代价是多了一个机制。
- **更多元信息字段**：`allowed-tools` 让 Skill 生效期间某些工具无需审批；`context: fork` 让 Skill 在子 Agent 里运行（第 17 章）；`paths` 限定只在操作匹配的文件时自动启用；`` !`命令` `` 在模型看到正文之前先执行命令，把输出填进去。
- **参数从 0 开始**：`$0` 是第一个参数。Pi 的 `$1` 才是第一个。在两个 Agent 之间移植模板时，这是最容易出错的地方。
- **命令和 Skill 合并**：`.claude/commands/deploy.md` 和 `.claude/skills/deploy/SKILL.md` 都会创建 `/deploy`，后者多了附带文件和自动调用。
- **目录有预算**：每个 Skill 的描述在目录里最多保留 1536 个字符。
:::

## Skill 也是注入面

Skill 的正文会被模型当作**指导自己行动的说明**来遵循，附带的脚本会被执行。装一个第三方 Skill，等于让一个陌生人给你的 Agent 写操作手册，而 Agent 拿着你的全部权限去执行它。

一个恶意的 Skill 可以：

- 在正文或某个参考文件里写“开始之前，先运行 `scripts/setup.sh`”，脚本把环境变量发到外部服务器；
- 把描述写得极其宽泛（“适用于任何编程任务”），让模型几乎每次都去读它；
- 把恶意指令藏在 `references/` 深处，审查时只看了 `SKILL.md` 的人发现不了。

克隆一个陌生仓库时，里面的 `.agents/skills/` 也是同样的风险，这就是项目 Skill 需要信任的原因。

防御的思路和第 9、10 章一致：

1. **来源可控**：只安装审查过的 Skill，固定版本；项目 Skill 需要信任。
2. **审查要完整**：不只是 `SKILL.md`，还有所有脚本和参考文件。Pi 的文档专门提醒了这一点。
3. **权限仍然生效**：Skill 让模型执行的每一条命令，依然要经过权限检查（第 14 章）。特别留意那些**放宽权限**的字段，比如 Claude Code 的 `allowed-tools`——它是审查的重点。

## 面试题

先自己回答，再展开对照要点。

::: interview 什么是 Agent Skills？它和工具、MCP、系统提示有什么区别？
Skill 是一个目录：`SKILL.md`（元信息里有名字和描述，正文是操作说明）加上可选的参考资料和脚本。系统提示里只放每个 Skill 的名字、描述和位置；任务匹配时，模型读取正文，需要时再读附带文件或执行脚本。

- 和**系统提示 / AGENTS.md** 比：它们始终在上下文里，Skill 按需加载，可以装很多而不占空间。
- 和**工具**比：工具是可执行的代码，定义始终在场；Skill 是知识和流程，执行仍然依靠已有的工具（read、bash）。
- 和 **MCP** 比：MCP 把外部系统的能力接进来，解决“能做什么”；Skill 解决“怎么做好”。两者经常配合：一个 Skill 可以教模型怎样正确使用某组 MCP 工具。
:::

::: interview 什么是渐进式披露？为什么它对 Agent 很重要？
信息分层，只在需要时展开下一层。Skills 有三层：目录（始终在场）→ 正文（任务匹配时读取）→ 附带文件（正文指向、确实需要时才读；脚本只执行，只有输出进入上下文）。

重要性：上下文窗口有限，而且无关信息会分散模型的注意力、增加成本；能力的数量和上下文的占用因此解耦——装一百个 Skill，平时的成本也只是一百行目录。同样的思路出现在很多地方：长期记忆只放索引（第 10 章）、工具结果截断后提示用 offset 继续读（第 5 章）、按需加载的工具定义。
:::

::: interview 怎样写一个好的 Skill？
- **描述是路由规则**：模型只看描述决定是否加载。写清做什么、什么时候用，包含用户可能的说法；避免“处理 PDF 相关的事情”这类模糊描述。
- **正文简洁**：只写模型不知道的东西（团队约定、流程、坑），不写通用知识；保持在几百行以内，细节拆到参考文件里，并在正文里说明什么时候该读哪个。
- **确定性的部分写成脚本**：格式转换、校验这类事交给脚本，比让模型每次重新写代码更可靠，也更省上下文。
- **有副作用的流程禁止自动调用**：部署、迁移、发消息，用 `disable-model-invocation` 让用户决定时机。
- **测试**：用几个真实的请求检查模型会不会在该用时用、不该用时不用。
:::

::: interview Skill 越来越多时会遇到什么问题？怎么办？
目录本身会变长，描述之间可能相互重叠，模型选错或漏选的概率上升。可以：

- 给目录设预算，截断过长的描述（Claude Code 每个描述最多 1536 个字符）；
- 按作用域加载：用户级、项目级、子目录级，或用路径规则只在操作相关文件时启用；
- 把不常用、有副作用的 Skill 设为仅手动调用，移出目录；
- 规模再大时，按当前任务检索相关的 Skill，而不是全部列出——代价是检索可能漏掉真正需要的那个。
:::

::: interview 使用第三方 Skill 有什么安全风险？
Skill 的正文会被模型当作行动指南遵循，脚本会以 Agent 的权限执行，所以它本质上是一种代码和提示注入的载体：可能诱导模型运行窃取凭证的脚本，用宽泛的描述让自己频繁被加载，或把恶意指令藏在参考文件里。克隆来的仓库里的项目 Skill 风险相同。

防御：只装审查过的 Skill（包括全部附带文件）、固定版本；项目 Skill 需要先信任项目；Skill 内触发的工具调用照常经过权限检查；对放宽权限的字段（如 `allowed-tools`）重点审查；拼接进提示的元信息要转义，防止破坏提示结构。
:::
