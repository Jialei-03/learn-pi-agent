// PreToolUse（Bash）：改写参数——部署脚本一律加上 --dry-run，并告诉模型发生了什么。
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { tool_input } = JSON.parse(raw);
const command = tool_input.command ?? '';
if (command.startsWith('./deploy.sh') && !command.includes('--dry-run')) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...tool_input, command: `${command} --dry-run` },
      additionalContext: '部署命令已被钩子自动加上 --dry-run，没有真正部署。',
    },
  }));
}
