const { ApiError } = require('./errors');

const PAGE_SIZE = 100;
/** 日常读取（列表、按月账目）的上限；超过时报错，绝不静默少读。 */
const MAX_ROWS = 2000;
/** 导出不受 MAX_ROWS 限制，但仍设一个防止失控的上限。 */
const MAX_EXPORT_ROWS = 20000;

function page(collection, where, index, size = PAGE_SIZE) {
  return collection
    .where(where)
    .orderBy('_id', 'asc')
    .skip(index * PAGE_SIZE)
    .limit(size)
    .get()
    .then((result) => result.data);
}

/** 读出全部匹配记录；超过 MAX_ROWS 条时抛出 TOO_MANY。 */
async function listAll(collection, where = {}) {
  const rows = [];
  for (let index = 0; index * PAGE_SIZE < MAX_ROWS; index++) {
    const data = await page(collection, where, index);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
  const extra = await page(collection, where, MAX_ROWS / PAGE_SIZE, 1);
  if (extra.length > 0)
    throw new ApiError(
      'TOO_MANY',
      `记录超过 ${MAX_ROWS} 条，暂时无法完整显示。数据没有丢失，可以先在设置里复制全部数据备份。`,
    );
  return rows;
}

/** 导出用：按 count() 分页读完，读到的条数必须与 count() 一致。 */
async function readComplete(collection, where = {}) {
  const { total } = await collection.where(where).count();
  if (total > MAX_EXPORT_ROWS)
    throw new ApiError(
      'TOO_MANY',
      `记录超过 ${MAX_EXPORT_ROWS} 条，无法导出。`,
    );
  const rows = [];
  for (let index = 0; index * PAGE_SIZE < total; index++) {
    const data = await page(collection, where, index);
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  if (rows.length !== total)
    throw new ApiError(
      'INCOMPLETE',
      '导出时数据有变动，没有读完整，请稍后重试。',
    );
  return rows;
}

module.exports = {
  listAll,
  readComplete,
  PAGE_SIZE,
  MAX_ROWS,
  MAX_EXPORT_ROWS,
};
