// PostToolUse（Bash）：工具已经执行完，在结果交给模型之前把密钥抹掉。
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { tool_response } = JSON.parse(raw);
const stdout = tool_response?.stdout ?? '';
const redacted = stdout.replace(/sk-[A-Za-z0-9-]{8,}/g, '[REDACTED]');
if (redacted !== stdout) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: { ...tool_response, stdout: redacted } } }));
}
