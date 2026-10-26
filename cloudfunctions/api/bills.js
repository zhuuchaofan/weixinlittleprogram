/**
 * 截图记账：微信 / 支付宝账单列表截图 → 视觉模型读出每一笔 → 查重 → 用户确认后批量保存。
 * - 导入的账一律记为上传者付款、split === 'self'（不参与分摊）。
 * - 每笔导入的账有 src.key（App + 原始日期、时刻、金额、商户、收支）；
 *   _id 由小家和 key 算出，同一笔账两人同时导入也只落一次。
 * - 读图结果的解析在 bill-parse.js，查重在 bill-match.js。
 */
const crypto = require('node:crypto');
const { ApiError } = require('./errors');
const validate = require('./validate');
const CONTRACT = require('./contract.json');
const { SETTLEMENT } = require('./ledger');
const { todayKey } = require('./dates');
const {
  KINDS,
  MAX_ITEMS,
  MERCHANT_MAX,
  DAY_MS,
  PROMPT,
  str,
  dayKey,
  keyToMs,
  parseTime,
  billKey,
  noteFor,
  parseReply,
} = require('./bill-parse');
const { matchItems } = require('./bill-match');

const DAILY_IMAGES = CONTRACT.billImport.dailyImages;

const BAD_SOURCE = '截图信息无效，请重新识别。';

/** 前端送回来的截图原始字段（bill.parse 给出的 src）：逐项校验后重新算 key，不相信前端的 key。 */
function sourceOf(raw) {
  const src = raw?.src;
  if (
    !src ||
    !Number.isInteger(src.amount) ||
    src.amount < 0 ||
    src.amount > CONTRACT.maxAmount ||
    (src.date !== '' && !validate.isDate(src.date))
  )
    throw new ApiError('VALIDATION', BAD_SOURCE);
  const result = {
    app: validate.oneOf(src.app, CONTRACT.billApps, BAD_SOURCE),
    merchant: validate.text(src.merchant, { field: '商户', max: MERCHANT_MAX }),
    time: parseTime(src.time),
    date: src.date,
    amount: src.amount,
    flow: validate.oneOf(src.flow, CONTRACT.flows, BAD_SOURCE),
  };
  return { ...result, key: billKey(result) };
}

/** bill.parse 的一笔原样送回来查重：按原始字段重建，status 由服务端判断。 */
function checkedItem(raw) {
  const { key, ...src } = sourceOf(raw);
  const kind = KINDS.includes(raw.kind) ? raw.kind : '其他';
  return {
    amount: src.amount,
    flow: src.flow,
    date: src.date,
    dateGuessed: raw.dateGuessed === true,
    time: src.time,
    kind,
    merchant: src.merchant,
    note: noteFor(kind, src.merchant),
    cat:
      CONTRACT.categories.includes(raw.cat) && raw.cat !== SETTLEMENT
        ? raw.cat
        : '其他',
    src,
    key,
    problem: [!src.amount && '金额没读出来', !src.date && '日期没读出来']
      .filter(Boolean)
      .join('，'),
  };
}

function monthsAround(dates) {
  const months = new Set();
  for (const date of dates) {
    const ms = keyToMs(date);
    for (const delta of [-1, 0, 1])
      months.add(dayKey(ms + delta * DAY_MS).slice(0, 7));
  }
  return [...months];
}

function itemList(payload) {
  const items = payload?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS)
    throw new ApiError('VALIDATION', `一次最多导入 ${MAX_ITEMS} 笔。`);
  return items;
}

/**
 * repository：expenses 集合（listMonth、insertWithId）。
 * households：takeBillQuota(id, day, limit) -> boolean，每个小家每天最多识别 DAILY_IMAGES 张。
 * vision：{ read(imageUrl, prompt) -> 模型回复文本 }；没有配置模型时为 null。
 */
function createBillHandler({
  repository,
  households,
  requireMembership,
  now,
  vision,
}) {
  return {
    async 'bill.parse'(openid, payload) {
      const household = await requireMembership(openid);
      if (!vision)
        throw new ApiError(
          'UNAVAILABLE',
          '截图记账还没开通：需要在云函数 api 里配置 DASHSCOPE_API_KEY。',
        );
      const url = str(payload?.url);
      if (!/^https:\/\/\S{1,1000}$/.test(url))
        throw new ApiError('VALIDATION', '截图上传失败，请重试。');
      const today = todayKey(now());
      // 先占额度再调模型：识别失败也算一次，避免反复重试刷用量。
      if (!(await households.takeBillQuota(household._id, today, DAILY_IMAGES)))
        throw new ApiError(
          'LIMIT',
          `今天已经识别了 ${DAILY_IMAGES} 张截图，明天再来吧。`,
        );
      return parseReply(await vision.read(url, PROMPT), today);
    },
    async 'bill.match'(openid, payload) {
      const household = await requireMembership(openid);
      const items = itemList(payload).map(checkedItem);
      const dates = items.map((item) => item.date).filter(Boolean);
      const records = (
        await Promise.all(
          monthsAround(dates).map((month) =>
            repository.listMonth(household._id, month),
          ),
        )
      ).flat();
      return { items: matchItems(items, records, household) };
    },
    async 'expense.addMany'(openid, payload) {
      const household = await requireMembership(openid);
      const payer = household.members.find(
        (member) => member.openid === openid,
      ).role;
      const docs = itemList(payload).map((item) => {
        const { app, merchant, time, key } = sourceOf(item);
        return {
          ...validate.expense({ ...item, payer, split: 'self' }),
          src: { app, merchant, time, key },
          householdId: household._id,
          ts: now(),
          by: openid,
        };
      });
      let added = 0;
      // 逐批写入；_id 由小家和 key 决定，已存在的（导入过或对方刚导入）跳过。
      for (let i = 0; i < docs.length; i += 10) {
        const results = await Promise.all(
          docs
            .slice(i, i + 10)
            .map((doc) =>
              repository.insertWithId(
                'bill_' +
                  crypto
                    .createHash('sha256')
                    .update(`${household._id}\n${doc.src.key}`)
                    .digest('hex')
                    .slice(0, 24),
                doc,
              ),
            ),
        );
        added += results.filter(Boolean).length;
      }
      return { added, skipped: docs.length - added };
    },
  };
}

module.exports = { createBillHandler };
