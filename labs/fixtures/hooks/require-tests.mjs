// Stop：模型说“做完了”，但没提到测试通过——不让它停，要求先跑测试。
// stop_hook_active 为 true 表示这一轮本来就是 Stop 钩子要求的；再拦就可能无限循环，所以放行。
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { stop_hook_active, last_assistant_message } = JSON.parse(raw);
if (!stop_hook_active && !/测试通过|tests? pass/i.test(last_assistant_message ?? '')) {
  console.log(JSON.stringify({ decision: 'block', reason: '结束之前请先运行 npm test，并报告结果。' }));
}
