// 第 9 章实验：哪些地址算“内网”？
//   node labs/ch09/ssrf.ts
// 用 web_fetch 的 checkUrl 逐个检查一组 URL。都是 IP 字面量，不需要网络。
import assert from 'node:assert/strict';
import { checkUrl } from '../../extensions/web-fetch/fetch.ts';

const cases: [string, string, boolean][] = [
  ['http://93.184.216.34/', '公网 IPv4', true],
  ['http://127.0.0.1:8080/', '本机回环', false],
  ['http://169.254.169.254/latest/meta-data/', '云实例元数据服务', false],
  ['http://10.1.2.3/', '私有网段 10/8', false],
  ['http://100.64.0.1/', '运营商级 NAT（100.64/10）', false],
  ['http://0.0.0.0/', '“本机任意地址”', false],
  ['http://[::1]/', 'IPv6 回环', false],
  ['http://[::]/', 'IPv6 未指定地址', false],
  ['http://[fd00::1]/', 'IPv6 私有地址', false],
  ['http://[::ffff:169.254.169.254]/', 'IPv4 映射地址（点分写法）', false],
  ['http://[::ffff:a9fe:a9fe]/', 'IPv4 映射地址（十六进制写法）', false],
  ['http://[64:ff9b::a9fe:a9fe]/', 'NAT64 前缀里的元数据地址', false],
  ['http://[2606:4700:4700::1111]/', '公网 IPv6', true],
  ['file:///etc/passwd', '非 http(s) 协议', false],
];

console.log('| URL | 是什么 | 结果 |');
console.log('| --- | --- | --- |');
for (const [url, what, allowed] of cases) {
  const refusal = await checkUrl(url);
  console.log(`| \`${url}\` | ${what} | ${refusal ? '拒绝' : '放行'} |`);
  assert.equal(!refusal, allowed, url);
}
