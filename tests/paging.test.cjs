const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listAll,
  readComplete,
  MAX_ROWS,
} = require('../cloudfunctions/api/paging');

/** 模拟 CloudBase 集合的链式查询：where / orderBy / skip / limit / get / count。 */
function fakeCollection(count, { reportedTotal = count } = {}) {
  const rows = Array.from({ length: count }, (_, i) => ({
    _id: String(i).padStart(6, '0'),
  }));
  const calls = { get: 0 };
  const collection = {
    calls,
    where() {
      const query = { skip: 0, limit: 100 };
      const chain = {
        orderBy: () => chain,
        skip(n) {
          query.skip = n;
          return chain;
        },
        limit(n) {
          // 与 CloudBase 一致：单次最多 100 条
          query.limit = Math.min(n, 100);
          return chain;
        },
        async get() {
          calls.get++;
          return { data: rows.slice(query.skip, query.skip + query.limit) };
        },
        async count() {
          return { total: reportedTotal };
        },
      };
      return chain;
    },
  };
  return collection;
}

test('listAll：上限以内全部读出', async () => {
  assert.equal((await listAll(fakeCollection(0))).length, 0);
  assert.equal((await listAll(fakeCollection(250))).length, 250);
  assert.equal((await listAll(fakeCollection(MAX_ROWS))).length, MAX_ROWS);
});

test('listAll：超过上限时报 TOO_MANY，不静默少读', async () => {
  await assert.rejects(listAll(fakeCollection(MAX_ROWS + 1)), {
    code: 'TOO_MANY',
  });
});

test('readComplete：2001 条完整读出，与 count() 一致', async () => {
  const rows = await readComplete(fakeCollection(MAX_ROWS + 1));
  assert.equal(rows.length, MAX_ROWS + 1);
  assert.equal(new Set(rows.map((r) => r._id)).size, MAX_ROWS + 1);
});

test('readComplete：读到的条数与 count() 不一致时报错', async () => {
  await assert.rejects(
    readComplete(fakeCollection(2001, { reportedTotal: 2003 })),
    { code: 'INCOMPLETE' },
  );
  await assert.rejects(
    readComplete(fakeCollection(150, { reportedTotal: 120 })),
    { code: 'INCOMPLETE' },
  );
});
