# Session 与 Compaction：会话树怎样变成模型输入

从关闭后恢复对话这个场景出发，本章解释消息怎样保存、分支怎样选择，以及会话变长时如何继续运行。关键类是 `SessionManager`。

![Mox 解释本章的机制关系](../assets/mox-mechanisms/context.png)

## 1. 追加记录构成会话树

会话 Entry 不只有聊天文本，还记录模型变化、压缩、分支摘要等信息。消息有 ID 和父节点 ID，当前叶子确定活动路径。

源码摘录：[packages/coding-agent/src/core/session-manager.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts#L1214)

```ts
appendMessage(message: Message | CustomMessage | BashExecutionMessage): string {
	const entry: SessionMessageEntry = {
		type: "message",
		id: generateId(this.byId),
		parentId: this.leafId,
		timestamp: new Date().toISOString(),
		message,
	};
	this._appendEntry(entry);
	return entry.id;
}

```

新消息以当前叶子为父节点。分支可以保留另一条尝试的记录，不需要删除原来的历史。文件里存在某条消息，不代表当前模型一定能看到它。

## 2. 从树投影出 Context

`getBranch()` 选择活动路径；`buildContextEntries()`、`buildSessionProjection()` 和 `buildSessionContext()` 组织可用于恢复运行的内容。

源码摘录：[packages/coding-agent/src/core/session-manager.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts#L576)

```ts
export function buildSessionContext(
	entries: SessionEntry[],
	leafId?: string | null,
	byId?: Map<string, SessionEntry>,
): SessionContext {
	const { messages, thinkingLevel, model } = buildSessionProjection(entries, leafId, byId);
	return { messages, thinkingLevel, model };
}

/**
 * Compute the default session directory for a cwd.
 * Encodes cwd into a safe directory name under ~/.pi/agent/sessions/.
 */
function getDefaultSessionDirPath(cwd: string, agentDir: string = getDefaultAgentDir()): string {
	const resolvedCwd = resolvePath(cwd);
	const resolvedAgentDir = resolvePath(agentDir);
```

投影是从丰富的存档中构造一种用途的视图。完整会话、UI 显示和 Provider 输入可以依赖同一批事实，却无需拥有相同字段和条目集合。

## 3. 何时写入消息

AgentSession 订阅 Agent 事件，在对应的 `message_end` 路径中处理完整消息并交给 SessionManager。文本增量适合即时显示，不应把每个片段都当成完整 assistant 消息反复追加。

恢复会话恢复的是已记录事实，并不会恢复任意 Bash 子进程的内存和程序位置。外部副作用与持久状态的关系将在 Durable 章节继续展开。

## 4. 怎样判断需要压缩

源码摘录：[packages/coding-agent/src/core/compaction/compaction.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts#L267)

```ts
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
	if (!settings.enabled) return false;
	return contextTokens > contextWindow - settings.reserveTokens;
}

// ============================================================================
// Cut point detection
// ============================================================================
```

压缩判断考虑上下文用量、窗口和配置；用量估计还涉及最近消息与投影后的内容。将“磁盘占用多大”等同于“模型窗口用了多少”会得到错误判断。

## 5. 压缩的执行路径

`prepareCompaction()` 选择保留边界和待摘要材料；摘要通过模型生成；`compact()` 组织结果。AgentSession 保存压缩 Entry，再重建模型上下文。

切分必须顾及 turn、系统变化与工具请求/结果关联。只留工具结果却丢失调用，会使消息关系破坏；把新的工具声明变化丢掉，也可能使后续请求与可执行能力不一致。

## 6. 摘要、分支与记忆

分支摘要把另一条路径中的发现带到当前工作，而不是合并进程的全部状态。Compaction 同样是有损的，原始材料仍可能需要重新读取。

Session 保存记录，检索帮助找回窗口外材料，Memory 是系统选择跨任务保留信息的策略。Pi 的会话提供材料和生命周期，不意味着模型永久记住全部历史。

## 7. 从测试定位恢复问题

会话测试覆盖上下文构建、分支、文件与压缩；自动压缩队列测试还检查准备期间的新输入。诊断时先核对叶子、压缩边界与投影内容，再判断模型是否理解了它收到的材料。

下一章进入 MCP，观察外部进程与服务如何接回工具运行链。

## 8. 从分支示意到真实投影

下面用教学 ID 表达一棵树：`A → B → C`，从 B 又分出 D。活动叶子为 D 时，路径是 `A → B → D`；C 仍在文件中，却不会仅因存在就自动进入活动路径。

更丰富的上下文投影还处理上下文编辑和压缩条目：

源码摘录：[packages/coding-agent/src/core/session-manager.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts#L551)

```ts
const edits = new Map<string, ContextEditEntry>();
for (const entry of contextEntries) {
	if (entry.type === "context_edit") edits.set(entry.targetId, entry);
}
const projectedEntries = contextEntries.map(
	(sourceEntry, index): ProjectedSessionEntry => ({
		sourceEntry,
		// buildContextEntries() may retain an older compaction entry because its
		// raw ID lies inside the newest retained range. Only the newest compaction
		// at index zero contributes a checkpoint and summary.
		messages:
			sourceEntry.type === "compaction" && index > 0
				? []
				: projectContextEntry(sourceEntry, edits.get(sourceEntry.id)),
	}),
);
```

这里先收集针对条目的编辑，再保留来源条目与投影消息的对应关系。若较旧压缩条目仍位于保留范围内，也不能重复把所有历史摘要都作为当前检查点叠加进去。

因此恢复异常不只可能来自读取 JSONL 失败：叶子选择、上下文编辑、最新压缩边界和历史系统消息，都可能改变最终模型输入。


[继续阅读：MCP：外部服务怎样进入 Pi 的工具链](07-mcp-protocol-and-pi-integration.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
