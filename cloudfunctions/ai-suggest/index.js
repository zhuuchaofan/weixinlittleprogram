/**
 * AI 接口占位（docs/PLAN.md 第 7 节）。对外契约固定：
 * 输入 { scene: 'food' | 'weekend', context: {...}, probe?: true }
 * 输出 { disabled: boolean, items: [...] }
 *
 * - 尚未接入模型：始终返回 { disabled: true, items: [] }。
 * - probe: true 只查询是否可用，不生成内容（小程序据此决定是否显示「让 AI 推荐」）。
 * - 以后接入模型只改本函数；不要在代码里写死任何 API 密钥。
 */
const SCENES = ['food', 'weekend'];

function disabled() {
  return { disabled: true, items: [] };
}

async function suggest(event) {
  if (!SCENES.includes(event?.scene)) return disabled();
  // 接入模型时：校验调用者为小家成员，按 scene 组装提示词并返回 items。
  return disabled();
}

exports.suggest = suggest;
exports.main = async (event) => {
  try {
    return await suggest(event);
  } catch {
    return disabled();
  }
};
