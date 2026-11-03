// UserPromptSubmit：提示里像是有密码，就拦下来，不发给模型。
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { prompt } = JSON.parse(raw);
if (/密码(是|:|：)|password\s*[:=]/i.test(prompt)) {
  console.log(JSON.stringify({ decision: 'block', reason: '提示里似乎包含密码，已拦下。请改用环境变量或密钥管理工具。' }));
}
