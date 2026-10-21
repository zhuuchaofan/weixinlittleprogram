const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const validate = require('../cloudfunctions/api/validate');
const { SETTLEMENT } = require('../cloudfunctions/api/ledger');

const root = join(__dirname, '..');
const contract = JSON.parse(
  readFileSync(join(root, 'shared/contract.json'), 'utf8'),
);

test('契约副本与 shared/contract.json 一致（漏跑 npm run contract 会失败）', async () => {
  const { render } = await import('../scripts/contract.mjs');
  for (const [path, expected] of Object.entries(render()))
    assert.equal(
      readFileSync(join(root, path), 'utf8'),
      expected,
      `${path} 与源文件不一致，请运行 npm run contract`,
    );
});

test('云函数校验使用契约里的取值与长度', () => {
  assert.deepEqual(validate.CATEGORIES, contract.categories);
  assert.deepEqual(validate.DISH_TAGS, contract.dishTags);
  assert.equal(SETTLEMENT, contract.settlement);
  const max = contract.lengths.todoText;
  const todo = (text) => validate.todo({ text, kind: 'shop', who: 'a' });
  assert.equal(todo('x'.repeat(max)).text.length, max);
  assert.throws(() => todo('x'.repeat(max + 1)), { code: 'VALIDATION' });
});
