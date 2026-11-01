# Skills 与 Prompt Templates：工作方法怎样进入请求

用户可能反复要求相同格式的代码评审。工具提供读文件、运行测试等动作，Skill 则描述方法、顺序和标准。本章沿加载、索引、正文读取和命令展开，解释 Pi 的具体实现。

![Mox 区分方法说明与可执行扩展](../assets/mox-mechanisms/extensions.png)

## 1. Skill 是可发现的指令资源

`skills.ts` 解析目录中的 `SKILL.md` 和 frontmatter，得到名字、描述、位置及诊断。描述帮助模型判断任务是否匹配；正文和附属资料在需要时再读取。

源码摘录：[packages/coding-agent/src/core/skills.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/skills.ts#L358)

```ts
export function formatSkillsForPrompt(skills: Skill[], fileReadTool: "read" | "bash" | "indirect" = "read"): string {
	const visibleSkills = skills.filter((s) => !s.disableModelInvocation);

	if (visibleSkills.length === 0) {
		return "";
	}

	const lines = [
		"\n\nThe following skills provide specialized instructions for specific tasks.",
		fileReadTool === "read"
			? "Use the read tool to load a skill's file when the task matches its description."
			: fileReadTool === "bash"
				? "Use bash to load a skill's file when the task matches its description."
				: "Load a skill's file when the task matches its description.",
		"Resolve relative paths against the skill's directory (parent of SKILL.md). Use absolute paths in tool calls.",
		"",
		"<available_skills>",
```

`disableModelInvocation` 可以让某个 Skill 不进入模型自动选择的索引，但仍能被用户显式调用。索引可见性、资源是否存在、正文是否已加载，是三件事。

## 2. 渐进式披露的真实含义

系统提示中主要放名字、说明和路径，而不是把所有 Skill 正文都塞入每次请求。模型根据说明选择后，使用当前可用的读取能力加载正文。

这样可以节省 Context，但不是自动保证选择正确。描述太宽会造成误触发，太窄则会遗漏；正文要求的工具缺失时，Skill 也不能凭文字创造新的执行能力。

## 3. 显式 `/skill:name`

AgentSession 的 `_expandSkillCommand()` 处理用户显式调用，把相应内容放入输入路径。它与模型自行选择并调用 `read` 读取 Skill 是两条流程。

源码摘录：[packages/coding-agent/src/core/agent-session.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts#L2232)

```ts
private _expandSkillCommand(text: string): string {
	if (!text.startsWith("/skill:")) return text;

	const spaceIndex = text.indexOf(" ");
	const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
	const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

	const skill = this.resourceLoader.getSkills().skills.find((s) => s.name === skillName);
	if (!skill) return text; // Unknown skill, pass through

	try {
		const content = readFileSync(skill.filePath, "utf-8");
		const body = stripFrontmatter(content).trim();
		const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
		return args ? `${skillBlock}\n\n${args}` : skillBlock;
	} catch (err) {
		// Emit error like extension commands do
		this._extensionRunner.emitError({
```

脚本、图片和 `references/` 目录是附属资源。正文引用它们并不代表文件会自动执行；只有后续工具调用真正发生，执行才会发生。

## 4. Prompt Template 的参数展开

Prompt Template 更接近一段可复用的输入文本。`parseCommandArgs()` 处理参数，`substituteArgs()` 把位置参数、全部参数、默认值或切片替换到模板。

源码摘录：[packages/coding-agent/src/core/prompt-templates.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/prompt-templates.ts#L76)

```ts
export function substituteArgs(content: string, args: string[]): string {
	const allArgs = args.join(" ");

	return content.replace(
		/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
		(_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
			if (defaultTarget) {
				const value =
					defaultTarget === "@" || defaultTarget === "ARGUMENTS" ? allArgs : args[parseInt(defaultTarget, 10) - 1];
				return value ? value : defaultValue;
			}

			if (sliceStart) {
				let start = parseInt(sliceStart, 10) - 1; // Convert to 0-indexed (user provides 1-indexed)
				// Treat 0 as 1 (bash convention: args start at 1)
				if (start < 0) start = 0;
```

实现只在模板字符串上替换，不递归地把参数里看似 `$1` 的文本再展开。这个边界避免用户输入被多次解释。模板展开也不等于 Shell 执行；后续如果把文本当命令执行，仍要遵守命令参数的处理规则。

## 5. 三种能力的对照

| 对象 | 改变什么 | 运行位置 |
| --- | --- | --- |
| Skill | 模型采用的方法与上下文 | 指令经宿主进入模型请求 |
| Prompt Template | 用户输入文本 | 模型调用前的文本展开 |
| Extension | 工具、命令、事件、UI 等运行行为 | Pi 进程中的代码 |

一个发布工作流可以同时使用三者：模板收集输入，Skill 说明发布标准，Extension 注册必要的工具和状态显示。组合仍要沿明确的调用链发生。

## 6. 质量和安全的判断

有效 Skill 应减少任务遗漏、改善证据和产出，而不是只让回复更长。可以比较同一组任务使用前后的结果，但模型具有随机性，需要多次案例而非一次印象。

Skill 是进入 Context 的指令来源，附属脚本还可能带来执行风险。项目资源信任与系统隔离的作用范围不同，后面会结合资源加载代码继续解释。

## 7. 参数展开的可见结果

以下为教学示例：模板 `Review $1; focus: ${2:-correctness}` 接收参数 `src/app.ts` 时，第二个参数缺省，输出包含 `focus: correctness`；提供第二个参数时使用它。位置参数从 1 开始，内部数组索引则减 1。

如果用户参数本身含 `$1`，它作为参数值进入结果后，不再递归展开。参数替换与程序执行是不同阶段，因此模板里出现“运行测试”这几个字，并不表示已经有子进程启动。

Skill 正文的读取路径与模板不同：前者通常先出现在索引中，再由模型选择读取；显式 Skill 命令由 Session 展开。区分两条激活路径，才能解释为什么某次输入立即含有 Skill 正文，而另一次先出现工具读取事件。


[继续阅读：Extensions 与 Packages：能力怎样注册并参与运行](09-extensions-plugins-and-packages.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
