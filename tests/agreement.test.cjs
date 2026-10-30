const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const doc = readFileSync(join(root, 'docs/VIP-AGREEMENT.md'), 'utf8');
const { vip } = require('../shared/contract.json');

// 限时免费期间所有小家都算会员；这里测的是免费 / 会员各自的行为，所以先关掉。
process.env.VIP_FREE_UNTIL = 'off';

test('协议页数据与 docs/VIP-AGREEMENT.md 一致（漏跑 npm run agreement 会失败）', async () => {
  const { render, TARGET } = await import('../scripts/agreement.mjs');
  assert.equal(
    readFileSync(join(root, TARGET), 'utf8'),
    render(),
    `${TARGET} 与协议不一致，请运行 npm run agreement`,
  );
});

test('协议里的套餐价格和天数与契约一致', () => {
  for (const plan of vip.plans)
    assert.ok(
      doc.includes(`${plan.price / 100} 元，${plan.days} 天`),
      `协议里找不到 ${plan.name}：${plan.price / 100} 元，${plan.days} 天`,
    );
});

test('协议写明不退款，没有留口子的措辞', () => {
  assert.ok(doc.includes('不支持退款'));
  assert.ok(!doc.includes('一般不支持'));
  assert.ok(!doc.includes('特殊情况'));
});
