# Skills 与 Prompt Templates：一份 Markdown 在哪一轮被读到

项目有一份审阅指南。用户说「帮我审阅新模块」时，模型可能先调用 `read` 读取指南。用户改用 `/skill:review 新模块`，同一份指南却能直接出现在用户消息中。还有一种写法 `/review 新模块`，由提示模板展开。三种输入看起来都在「调用一个方法」，实际上有三条数据路径。

![Mox 演示 Skill 的索引、正文与附属材料](../assets/skill-illustrations/02-progressive-disclosure.png)

## 1. 从两个文件开始

下面的教学目录放在已启用项目资源的示例项目中。`SKILL.md` 描述如何工作，`criteria.md` 存放可选的详细标准；另一个目录里的 `review.md` 是用户可以点名的模板。

```text
/work/demo/.pi/
  skills/
    review/
      SKILL.md
      criteria.md
  prompts/
    review.md
```

`SKILL.md` 内容如下。顶部两个 `---` 之间的 YAML 称为 frontmatter，它供加载器读取元数据。空行以下是正文。

```markdown
---
name: review
description: 根据变更文件检查输入校验与失败处理。
---

先读取变更文件，列出公开输入和可能失败的外部调用。
遇到重试逻辑时，阅读同目录的 criteria.md。
```

发现时，`loadSkillFromFile` 读取文件、解析 frontmatter，构造的 `Skill` 对象含 `name`、`description`、`filePath`、`baseDir`、`sourceInfo` 和 `disableModelInvocation`。这里容易混淆「Pi 进程已经读过文件」与「模型已经收到正文」。加载器为了提取元数据读入了文件，传给索引格式化函数的对象里却没有正文属性。[源文件解析](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/skills.ts#L275)

如果 `name` 没有填写，加载器可以使用父目录名。`description` 缺失或全是空白时，这份 Skill 会被跳过。命名规则告警可以和加载成功同时出现。两条路径若经符号链接解析到同一已注册文件会去重；不同文件声明同名时，`loadSkills` 保留先遇到的记录，把胜者和落选路径写进碰撞诊断。实际次序取决于加载器给出的路径顺序，因此定位选错的指南要看获选 `filePath`。[发现、去重与诊断](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/skills.ts#L414)

### 为什么 criteria.md 没有成为第二份 Skill

发现过程有一个早于 frontmatter 的决定：这一级目录究竟是「装着许多 Skill 的容器」，还是「一份 Skill 的根」？`loadSkillsFromDirInternal` 会先搜索本级可用的 `SKILL.md`。一旦找到，它尝试加载这一份并返回当前目录的结果。即使同目录有 `criteria.md`，甚至还有一个子目录自己的 `SKILL.md`，也不会沿着这一次扫描把它们当作并列的技能继续注册。文件夹的结构在这里表达了归属，附属文件留给正文按需引用。[目录发现顺序](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/skills.ts#L163)

把上例改成 `skills/review/SKILL.md` 与 `skills/security/SKILL.md` 两个同级目录，顶层没有自己的 `SKILL.md`，递归才会分别抵达两份独立根目录。如果误把总说明命名为 `skills/SKILL.md`，子目录里的指南就可能从发现结果里一起消失。另一个容易漏掉的条件是「识别到了根文件，但正文解析失败」。例如这个文件缺 description，解析会给出诊断并跳过它；这一层扫描仍然已经按 Skill 根结束，所以不能指望下面一份恰好有效的文件自动补位。上游夹具同时放了根 Skill 和子 Skill，正好能用来区分这两种目录设计。[嵌套与根优先的测试材料](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/fixtures/skills/root-skill-preferred/SKILL.md)

### 两份同名指南的胜者是哪一份

`DefaultResourceLoader` 先解析配置中启用的路径，再将显式的附加路径合并进去；把候选目录交给 `loadSkills` 时传的是 `includeDefaults: false`，因为该由上层决定的来源已先合并好了。直接单独调用 `loadSkills({includeDefaults:true, ...})` 则会让低层函数自己补上默认目录。区分这两个调用入口很重要。若只记住某一类资源「总是用户优先」或「项目覆盖全局」，很容易在应用自己提供了一组路径时得出错误结论。[应用层向加载函数传参](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/resource-loader.ts#L880)

课程的小程序直接控制这组顺序。在两个临时目录分别写入 `team/review/SKILL.md`、`mine/review/SKILL.md`，两个 frontmatter 的名字都是 `review`。团队这份允许模型选择，个人这份设置 `disable-model-invocation: true`。我们只调换 `skillPaths` 的顺序，保持文件本身完全相同。从仓库根目录运行以下命令。[技能碰撞示例](../examples/read-loop/skills.mjs)

```bash
cd examples/read-loop
npm ci
node skills.mjs
```

```text
胜者 team，落选 mine，已登记 1，模型索引 含 review
胜者 mine，落选 team，已登记 1，模型索引 为空
```

第一行中，`skillMap` 收下团队版，遇到个人版时已有同名获选者，于是诊断记录 `winnerPath` 和 `loserPath`。第二行中，获选的是禁止模型自动选用的个人版。格式化阶段看到它的标志后将其移出索引，并不会「回去找一下允许自动用的落选版本」。加载器已经丢弃了那个候选者。这个先后顺序揭示了两个独立选择：加载器按名字选**哪份文件**，格式化器按可见条件选**哪些获选文件可以出现在系统提示**。即使模型一个名字也没见到，显式调用仍可能有确定的目标。

## 2. 模型自行选用时，第一次请求只有索引

`buildSystemPromptSections` 检查选中的工具和可见声明，决定是否加入技能索引，并给出合适的读文件提示。声明中若有 `read`，提示使用 `read`；需要通过间接机制读取时，提示避免硬编码一个未声明的工具名。然后 `formatSkillsForPrompt` 过滤 `disableModelInvocation`，逐个输出下面三个字段。[提示构建中的条件](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/system-prompt.ts#L171)

源码摘录：[packages/coding-agent/src/core/skills.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/skills.ts#L377)

```ts
for (const skill of visibleSkills) {
	lines.push("  <skill>");
	lines.push(`    <name>${escapeXml(skill.name)}</name>`);
	lines.push(`    <description>${escapeXml(skill.description)}</description>`);
	lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
	lines.push("  </skill>");
}
```

因此一次正常的教学输入会得到如下系统章节片段。正文中的「遇到重试逻辑」尚未出现，`criteria.md` 也还没读。

```xml
<available_skills>
  <skill>
    <name>review</name>
    <description>根据变更文件检查输入校验与失败处理。</description>
    <location>/work/demo/.pi/skills/review/SKILL.md</location>
  </skill>
</available_skills>
```

此时只有**模型选择**能触发下一步。设模型认为用户的任务匹配，它可以提出 `read({path:"/work/demo/.pi/skills/review/SKILL.md"})`。工具真正读取成功后，下一轮收到的 `toolResult` 里才出现文件内容。若模型随后需要详细标准，还需针对 `/work/demo/.pi/skills/review/criteria.md` 再次读取。相对引用的起点是 Skill 目录，即 `baseDir`。如果文件在发现后被移动，名称可能仍在这次索引快照中，真正的 `read` 却会失败。

```text
请求 1  系统消息含 description + location；用户消息含审阅要求
响应 1  assistant 发出 read(SKILL.md) 调用
宿主    read 返回文件内容，形成 toolResult
请求 2  原有消息 + assistant 调用 + toolResult；模型此时能读到方法正文
```

这种拆分把每轮常驻的信息限制在简短的描述和位置。代价是描述必须足以帮助模型做决定，选用后还需一次实际读取。

### 别把描述匹配误读成 Pi 的路由算法

索引里的三项字段会经过 XML 转义，再作为提示文字送出。这里没有一个根据用户话题计算相关分数、自动执行最高分 Skill 的本地函数。把描述从「检查输入校验与失败处理」改为笼统的「完成日常任务」，加载器仍可能生成相同结构的索引，变化发生在模型下一次决策所能读到的证据。前一种描述把何时读取这份指南说清楚，后一种描述几乎可以与每个请求匹配。如果用户要求读取特定版本指南但模型没有调用 read，排查时可以比较该轮提示中的名称与位置、它返回的工具调用名称和参数，再看实际 toolResult；在目录里确认文件存在只能解决第一步中的一部分。

相反，模型发出了读取请求也还不足以证明它拿到了全部材料。长 Skill 文件同样经过 `read` 的输出限制，引用的另一份文件仍不在这次工具返回里。比如 `criteria.md` 中才定义「最多重试两次」，模型只获得 `SKILL.md` 中的链接，便不能从该次结果得出「两次」这个具体标准。已经阅读的正文和仍然只是文字路径的材料，可以从实际工具结果边界区分。

## 3. 用户显式写出 /skill:review 时

`AgentSession.prompt` 在输入处理路径调用 `_expandSkillCommand`。该函数从 `/skill:` 后取第一个空格前的名字，从 `resourceLoader.getSkills().skills` 找到它，然后在宿主进程直接读取 `skill.filePath`，去掉 frontmatter 并把正文包起来。[命令解析与失败分支](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L2232)

源码摘录：[packages/coding-agent/src/core/agent-session.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L2243)

```ts
const content = readFileSync(skill.filePath, "utf-8");
const body = stripFrontmatter(content).trim();
const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
return args ? `${skillBlock}\n\n${args}` : skillBlock;
```

输入 `/skill:review 新模块` 变成的**用户消息文本**如下。模板字符串中的 `\n` 在运行时是换行。

```text
<skill name="review" location="/work/demo/.pi/skills/review/SKILL.md">
References are relative to /work/demo/.pi/skills/review.

先读取变更文件，列出公开输入和可能失败的外部调用。
遇到重试逻辑时，阅读同目录的 criteria.md。
</skill>

新模块
```

这条路径中读取正文不需要模型先选择或发出工具调用。若名称未找到，函数返回原文；若读取文件抛错，Session 会发出 `skill_expansion` 错误并返回原文。`disable-model-invocation: true` 只影响自动索引过滤，显式路径仍从已发现的技能集合按名字寻找。上游有一个测试把可见和禁用自动选择的 Skill 一同交给格式化器，断言结果只含前者，另一个测试检查全部禁用时最终结果是空字符串。[索引过滤测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/skills.test.ts#L308)

### 指南刚刚改过，哪一部分会立即生效

假设会话已启动，维护者只修改了 `SKILL.md`，把「检查输入校验」改成「同时检查取消信号」，但没有重新加载资源。已有索引使用的是发现时保存的描述，系统提示中已经生成的那一节也不会因为磁盘文件变了就自行重写。不过，只要原路径依然可读，模型后来使用 `read` 或用户显式展开时，会重新读取磁盘，因此可以拿到修改后的正文。若这次改的是文件名，旧索引又会指向之前的位置。模板的时机则不同，`loadTemplateFromFile` 在发现阶段把正文存进 `template.content`，展开时对这个已加载的字符串做替换。要让改过的模板正文成为本次展开的来源，需要刷新对应的资源集合。定位「改了文件怎么还显示旧字」时，可以分别查看索引的描述、已缓存的模板正文和工具实际读取到的文件内容。[模板内容的加载点](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/prompt-templates.ts#L113) · [显式 Skill 的读取点](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L2232)

## 4. /review 模板在发送前做字符串替换

同一项目的 `prompts/review.md` 可以只有一行正文：

```text
请审阅 $1；优先检查 ${@:2}。
```

用户输入 `/review "src/payment service.ts" 超时 重试`，`expandPromptTemplate` 先按命令名找到 `review` 模板，再把参数文本交给 `parseCommandArgs`。解析器在引号内部保留空格，在引号外遇到空白才结束当前参数。这是本地字符串解析，没有启动 shell。[参数解析与替换](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/prompt-templates.ts#L25)

| 阶段 | 手上的数据 |
| --- | --- |
| 命令名 | `review` |
| 参数数组 | `["src/payment service.ts", "超时", "重试"]` |
| `$1` | `src/payment service.ts` |
| `${@:2}` | 从第 2 个参数起，用空格连接，得到 `超时 重试` |
| 展开后的输入 | `请审阅 src/payment service.ts；优先检查 超时 重试。` |

`$@` 或 `$ARGUMENTS` 表示全部参数，`${2:-失败处理}` 表示第二个参数缺失或为空时使用给定值。替换只扫描原始模板一遍。如果用户的一项参数恰好是字面量 `$1`，插入它后不会拿它再替换一次。上游用参数本身含 `${@:2}` 的情况断言了这一点。这使模板接收包含 shell 写法的文本时仍能保留原意。[模板展开入口](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/prompt-templates.ts#L309) · [单次替换测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/prompt-templates.test.ts#L287)

### 引号、空值和文件名如何改变模板选择

模板名来自文件名（去掉 `.md`），因此两个目录各自有一份 `review.md` 时会发生模板名字冲突。应用层 `dedupePrompts` 顺序遍历结果，第一个名字留下；再遇同名项会记录 `resourceType: "prompt"` 并同时附上两条路径。Skill 使用独立的集合。相同的 `review` 可以同时存在于 Skill 与模板中，这两者不会互相占用同一张名字表。在排查碰撞时应先看诊断的资源类型，再看胜者路径。[模板文件解析](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/prompt-templates.ts#L113) · [模板碰撞处理](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/resource-loader.ts#L1192)

有时选中的模板完全正确，结果错误来自参数位置。比较 `/review "" 超时` 和 `/review 超时`。前者在引号内读到零个字符，但解析器通过 `hasToken` 记住「这里存在一个参数」，所以参数数组为 `["", "超时"]`。后者是 `["超时"]`。给定模板 `对象=${1:-默认模块}，关注=${2:-失败处理}`，前者展开为「对象=默认模块，关注=超时」，后者则为「对象=超时，关注=失败处理」。仅看两个参数拼接出的文本，可能看不出是否显式保留了那个空位置。遇到带路径与默认值的模板时，先写出数组，再从一开始给每项编号，替换结果就可以逐项检查。

### 一条斜杠输入会在哪一步被消费

现在给项目额外安装一个注册了 `/review` 命令的扩展。这时输入同一句 `/review 文件`，最先尝试的是扩展命令；命中并处理后 `prompt` 返回，原来的模板甚至没机会运行。若没有对应的扩展命令，则先把原始输入送给 `input` 处理器。它可以返回 `handled` 彻底消费输入，也可以 `transform` 输出另一段文本。之后 Session 先展开 `/skill:name`，再匹配提示模板，最后决定立即运行还是进入 `steer`、`followUp` 队列。这个顺序也解释了为什么输入观察器有时看到的是斜杠原文，模型看到的却是完整的用户提示。[普通输入处理顺序](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L2118) · [多个输入处理器的组合](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/runner.ts#L1535)

例如用户输入「审阅默认模块」，输入处理器把它换成 `/review 默认模块`。这个变化发生在扩展命令匹配已经完成之后，随后会进入模板匹配，但不会回到函数开头重新执行同名扩展命令。给定另一个输入处理器直接返回 `handled`，即使已装有该模板，也不会再产生展开后的用户消息。把流程看成一次从上向下的程序执行，才能解释为什么「看起来一样的一段命令文字」在不同位置产生不同结果。

## 5. 从消息轨迹判断发生了哪件事

假设已经进入普通 prompt 路径，且扩展没有提前消费输入。

| 入口 | 谁做选择 | 模型最早在哪儿看到方法或文本 | 运行时可观察的证据 |
| --- | --- | --- | --- |
| 用户说「帮我审阅」 | 模型根据技能描述判断 | 索引先出现；完整文件在读取后的工具结果里 | 有 assistant 的 `read` 请求及配对的 toolResult |
| 用户输入 `/skill:review 文件` | Session 按已发现的名字展开 | 首次用户消息就含 `<skill ...>` 正文 | 展开本身没有额外的工具调用 |
| 用户输入 `/review 文件` | Session 按模板名匹配 | 首次用户消息含替换后的提示 | 参数值成为文本，没有额外读取 Skill 的步骤 |

这三个入口可以共存。一份 Skill 中要求「运行测试」，只是正文的一句话；要让测试实际运行，还要由模型提出 `bash` 等动作并经过工具执行路径。下一章的 Extension 则能直接在宿主注册函数，改变工具执行或消息转换的行为。

> **先预测**　两个 Skill 同名，先发现的那份禁止模型自动调用。Pi 会改选第二份给模型看吗？
>
> **核对推导**　不会。加载器先按名字去重留下第一份，格式化索引时再根据自动调用标志过滤。排在后面的文件已在前一步落选，不会因胜者被隐藏而重新参选。显式按名调用又是另一条路径。

[继续阅读：扩展的注册、执行与拦截](09-extensions-plugins-and-packages.md) · [返回课程路线](00-source-learning-path.md)
