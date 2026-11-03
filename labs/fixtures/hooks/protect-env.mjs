// PreToolUse（Read|Edit|Write）：用 JSON 输出做决定——拒绝读写 .env 文件。
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { tool_input } = JSON.parse(raw);
if (/(^|\/)\.env(\.|$)/.test(tool_input.file_path ?? '')) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '.env 里是密钥，不允许 Agent 读写。需要配置项请问用户。' },
  }));
}
