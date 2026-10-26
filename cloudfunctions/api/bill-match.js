/**
 * 截图记账的查重：金额相同才算重复；src.key 一致 → 已导入过；日期相差不超过 1 天 → 可能已记过，
 * 优先对上同一天且商户与备注相似的那条。一条已有账目只能对上一笔。
 */
const { SETTLEMENT } = require('./ledger');
const { DAY_MS, keyToMs, str } = require('./bill-parse');

function plain(text) {
  return str(text)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function bigrams(text) {
  const result = [];
  for (let i = 0; i < text.length - 1; i++) result.push(text.slice(i, i + 2));
  return result;
}

/** 商户名与备注是否相似：一方包含另一方，或两字组重合度（Dice）≥ 0.4。 */
function similar(a, b) {
  const x = plain(a);
  const y = plain(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const xs = bigrams(x);
  const ys = bigrams(y);
  if (!xs.length || !ys.length) return false;
  const pool = [...ys];
  let common = 0;
  for (const gram of xs) {
    const index = pool.indexOf(gram);
    if (index >= 0) {
      common++;
      pool.splice(index, 1);
    }
  }
  return (2 * common) / (xs.length + ys.length) >= 0.4;
}

function daysApart(a, b) {
  return Math.abs(keyToMs(a) - keyToMs(b)) / DAY_MS;
}

/** 转给对方、对方转来的钱：两人之间的转账不记。 */
function isPartnerTransfer(item, household) {
  if (item.kind !== '转账' && item.kind !== '红包') return false;
  return household.members.some(
    (member) => member.name && item.merchant.includes(member.name),
  );
}

/**
 * 给每一笔打上 status：imported / possible / partner / new，
 * 撞上的已有账目放在 match。同一批里 key 相同的（连续截图的重叠部分）只留一笔。
 */
function matchItems(items, records, household) {
  const seen = new Set();
  const unique = items.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
  const candidates = records.filter((record) => record.cat !== SETTLEMENT);
  const used = new Set();
  const roleOf = (openid) =>
    household.members.find((member) => member.openid === openid)?.role || '';
  const describe = (record) => ({
    id: record._id,
    date: record.date,
    note: record.note,
    amount: record.amount,
    byRole: roleOf(record.by),
  });
  const take = (record) => {
    used.add(record._id);
    return describe(record);
  };
  const free = (record) => !used.has(record._id);
  // 先认领「已导入过」，再按相似程度认领，避免一条已有账目被松的规则先占掉。
  const result = unique.map((item) => {
    const exact = candidates.find(
      (record) => free(record) && record.src?.key === item.key,
    );
    return exact ? { ...item, status: 'imported', match: take(exact) } : item;
  });
  return result.map((item) => {
    if (item.status) return item;
    if (isPartnerTransfer(item, household))
      return { ...item, status: 'partner', match: null };
    if (!item.amount || !item.date)
      return { ...item, status: 'new', match: null };
    const same = candidates.filter(
      (record) =>
        free(record) &&
        record.amount === item.amount &&
        (record.flow || 'out') === item.flow &&
        daysApart(record.date, item.date) <= 1,
    );
    const best =
      same.find(
        (record) =>
          record.date === item.date &&
          (similar(item.merchant, record.note) ||
            similar(item.merchant, record.src?.merchant)),
      ) ||
      same.sort(
        (a, b) => daysApart(a.date, item.date) - daysApart(b.date, item.date),
      )[0];
    if (best) return { ...item, status: 'possible', match: take(best) };
    return { ...item, status: 'new', match: null };
  });
}

module.exports = { similar, matchItems };
