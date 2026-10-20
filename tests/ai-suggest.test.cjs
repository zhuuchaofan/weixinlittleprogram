const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../cloudfunctions/ai-suggest/index');

test('未接入模型时始终返回 disabled，且不抛错', async () => {
  for (const event of [
    {
      scene: 'food',
      context: { text: '想吃清淡的', city: '东京', dishes: ['拉面'] },
    },
    {
      scene: 'weekend',
      context: {
        dur: '半天',
        mood: '放松',
        budget: '5000',
        trans: '电车',
        city: '东京',
      },
    },
    { scene: 'food', probe: true },
    { scene: 'unknown' },
    null,
  ])
    assert.deepEqual(await main(event), { disabled: true, items: [] });
});
