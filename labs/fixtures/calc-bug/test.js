const assert = require('node:assert');
const { add, sub, mul } = require('./calc.js');

assert.strictEqual(mul(2, 3), 6, 'mul(2, 3) 应该是 6');
assert.strictEqual(sub(5, 2), 3, 'sub(5, 2) 应该是 3');
assert.strictEqual(add(2, 3), 5, 'add(2, 3) 应该是 5');
console.log('ok');
