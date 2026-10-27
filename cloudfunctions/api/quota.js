/**
 * 每个小家用 AI 功能的次数（contract.json 的 ai）：免费 / 会员各一个上限，按天（per: day）或按月（per: month）算。
 * 小家两人共用，会员也挂在小家上。计数存在 households 文档里，字段名见 fieldOf。
 * 先占额度再调模型：调用失败也算一次，避免反复重试刷用量。
 */
const { ApiError } = require('./errors');
const { ai: QUOTAS } = require('./contract.json');
const { todayKey } = require('./dates');
const { isVip } = require('./vip');

// 早期就有的两项沿用原来的字段名，已经用掉的次数不会清零。
const LEGACY_FIELDS = { billImage: 'billQuota', summary: 'summaryQuota' };

const fieldOf = (feature) => LEGACY_FIELDS[feature] || `${feature}Quota`;

function quotaOf(feature) {
  const quota = QUOTAS[feature];
  if (!quota) throw new Error(`AI 功能 ${feature} 没有额度`);
  return quota;
}

/** 这一期的键：按天是 YYYY-MM-DD，按月是 YYYY-MM（北京时间）。 */
function periodKey(per, at) {
  const day = todayKey(at);
  return per === 'month' ? day.slice(0, 7) : day;
}

function limitOf(household, feature, at) {
  const quota = quotaOf(feature);
  return isVip(household, at) ? quota.vip : quota.free;
}

/** 用完时的提示，例如「今天已经识别了 5 张截图，明天再来吧。开通会员每天可以识别 100 张。」 */
function limitMessage(household, feature, at) {
  const quota = quotaOf(feature);
  const [now, next, each] =
    quota.per === 'month'
      ? ['这个月', '下个月', '每月']
      : ['今天', '明天', '每天'];
  const limit = limitOf(household, feature, at);
  return (
    `${now}已经${quota.verb}了 ${limit} ${quota.unit}${quota.what}，${next}再来吧。` +
    (isVip(household, at)
      ? ''
      : `开通会员${each}可以${quota.verb} ${quota.vip} ${quota.unit}。`)
  );
}

/** households.takeQuota(id, field, period, limit) -> boolean；用完时抛 LIMIT。 */
async function takeQuota(households, household, feature, at) {
  const quota = quotaOf(feature);
  const ok = await households.takeQuota(
    household._id,
    fieldOf(feature),
    periodKey(quota.per, at),
    limitOf(household, feature, at),
  );
  if (!ok) throw new ApiError('LIMIT', limitMessage(household, feature, at));
}

module.exports = {
  takeQuota,
  limitOf,
  limitMessage,
  periodKey,
  fieldOf,
};
