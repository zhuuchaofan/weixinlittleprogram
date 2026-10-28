/**
 * 截图记账、账单文件导入的查重：金额相同才算重复；src.key 一致 → 已导入过；
 * 另一种方式导入过的同一笔（同日、同一分钟、同金额、同收支）→ 也算已导入过；
 * 日期相差不超过 1 天 → 可能已记过，优先对上同一天且商户与备注相似的那条。一条已有账目只能对上一笔。
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

/**
 * 对方名字是不是小家里的人。支付宝会把对方名字遮成「*蓉」，只剩姓或名的最后几个字，
 * 这时看小家里有没有人的名字以它结尾。
 */
function isMember(merchant, household) {
  const masked = /^\*+(.{1,2})$/.exec(merchant) || /^(.)$/.exec(merchant);
  return household.members.some((member) =>
    [member.name, member.payName].some(
      (name) =>
        name &&
        (merchant.includes(name) ||
          (masked && name.length > 1 && name.endsWith(masked[1]))),
    ),
  );
}

/** 转给对方、对方转来的钱：两人之间的转账不记。 */
function isPartnerTransfer(item, household) {
  if (item.kind !== '转账' && item.kind !== '红包') return false;
  return isMember(item.merchant, household);
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
  const same = (item) =>
    candidates.filter(
      (record) =>
        free(record) &&
        record.amount === item.amount &&
        (record.flow || 'out') === item.flow &&
        daysApart(record.date, item.date) <= 1,
    );
  // 截图和账单文件的 key 算法不同：同一笔账先截图、后导文件（或反过来）时，靠时刻对上。
  const sameMoment = (item) => (record) =>
    free(record) &&
    record.src?.time &&
    record.src.time === item.time &&
    record.date === item.date &&
    record.amount === item.amount &&
    (record.flow || 'out') === item.flow;
  // 整批分四轮认领：先 key 一致的「已导入过」，再时刻一致的，再同一天且商户相似的，最后才是日期相近的，
  // 避免一条已有账目被前面某一笔按松的规则先占掉。
  const exact = unique.map((item) =>
    candidates.find((record) => free(record) && record.src?.key === item.key),
  );
  exact.forEach((record) => record && used.add(record._id));
  const first = unique.map((item, index) => {
    if (exact[index])
      return { ...item, status: 'imported', match: describe(exact[index]) };
    const moment = item.time && candidates.find(sameMoment(item));
    if (moment) return { ...item, status: 'imported', match: take(moment) };
    if (isPartnerTransfer(item, household))
      return { ...item, status: 'partner', match: null };
    if (!item.amount || !item.date)
      return { ...item, status: 'new', match: null };
    return item;
  });
  const second = first.map((item) => {
    if (item.status) return item;
    const close = same(item).find(
      (record) =>
        record.date === item.date &&
        (similar(item.merchant, record.note) ||
          similar(item.merchant, record.src?.merchant)),
    );
    return close ? { ...item, status: 'possible', match: take(close) } : item;
  });
  // 日期相近的按相差天数从小到大配对，同一天的先配上。
  const pairs = second
    .flatMap((item, index) =>
      item.status
        ? []
        : same(item).map((record) => ({
            index,
            record,
            days: daysApart(record.date, item.date),
          })),
    )
    .sort((a, b) => a.days - b.days);
  const near = new Map();
  for (const { index, record } of pairs) {
    if (near.has(index) || !free(record)) continue;
    near.set(index, take(record));
  }
  return second.map((item, index) => {
    if (item.status) return item;
    if (near.has(index))
      return { ...item, status: 'possible', match: near.get(index) };
    return { ...item, status: 'new', match: null };
  });
}

/**
 * 商户 → 分类记忆：同一个商户以前导入后记在哪一类，这次就套用哪一类。
 * 不单独存，直接从已导入的账目（src.merchant + cat）里数；次数相同取最近的。
 * 只改收支为支出、商户名不空的；没记过的商户保持原来的分类。
 */
function rememberCategories(items, records) {
  const counts = new Map();
  for (const record of records) {
    const merchant = plain(record.src?.merchant);
    if (!merchant || record.cat === SETTLEMENT || !record.cat) continue;
    const cats = counts.get(merchant) || new Map();
    const seen = cats.get(record.cat) || { count: 0, last: '' };
    cats.set(record.cat, {
      count: seen.count + 1,
      last: record.date > seen.last ? record.date : seen.last,
    });
    counts.set(merchant, cats);
  }
  return items.map((item) => {
    const cats = item.flow === 'out' && counts.get(plain(item.merchant));
    if (!cats) return item;
    const [cat] = [...cats.entries()].sort(
      (a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last),
    )[0];
    return { ...item, cat };
  });
}

module.exports = { similar, matchItems, rememberCategories };
