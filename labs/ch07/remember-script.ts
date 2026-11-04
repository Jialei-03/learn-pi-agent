// 第 7 章 continue.ts 用的脚本模型：它没有任何记忆，只能看这次请求里带来的历史。
// 被问到代号时，从历史里找用户说过的“代号是……”；找不到就说不知道。
import type { Context } from '../../mox/src/types.ts';

const text = (m: Context['messages'][number]) => (typeof m.content === 'string' ? m.content : m.content.map(b => ('text' in b ? b.text : '')).join(''));

export default (context: Context) => {
  const last = text(context.messages.at(-1)!);
  if (!last.includes('代号是什么')) return { text: '好的，记住了。' };
  const said = context.messages.filter(m => m.role === 'user').map(text).find(t => /代号是[^什]/.test(t));
  return { text: said ? `代号是${said.match(/代号是(.+?)[。，,.]?$/)![1]}。` : '我不知道代号是什么。' };
};
