// PreToolUse（Bash）：按命令文本拦截 rm。最常见的写法，也是最容易被绕过的写法。
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { tool_input } = JSON.parse(raw);
if (/(^|[\s;&|(])rm(\s|$)/.test(tool_input.command ?? '')) {
  console.error('不允许删除文件（rm）。');
  process.exit(2);
}
