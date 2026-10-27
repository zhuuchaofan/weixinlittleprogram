import { ApiError, callApi } from './cloud';
import { getHousehold } from './household';

export interface VipPlan {
  id: string;
  name: string;
  days: number;
  /** 价格，单位：分 */
  price: number;
}

export interface VipInfo {
  active: boolean;
  /** 到期时间戳；没开通过为 0 */
  until: number;
  /** 云端是否配置好了虚拟支付 */
  available: boolean;
  plans: VipPlan[];
  dailyImages: number;
  dailySummaries: number;
}

interface VipOrder {
  mode: 'short_series_goods';
  signData: string;
  paySig: string;
  signature: string;
}

// 支付完成后，微信的发货推送通常几秒内到；最多等这么久，等不到就提示稍后刷新。
const POLL_TIMES = 8;
const POLL_GAP_MS = 1500;

export function getVip(): Promise<VipInfo> {
  return callApi<VipInfo>('vip.get');
}

/** 拉起虚拟支付收银台。成功回调只表示支付交互结束，不代表已经到账。 */
function requestPayment(order: VipOrder): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.requestVirtualPayment({
      mode: order.mode,
      // 文档要求以字符串传，且必须是云端签名时的那一段原文；类型定义写成了对象，只能强转。
      signData: order.signData as unknown as WechatMiniprogram.SignData,
      paySig: order.paySig,
      signature: order.signature,
      success: () => resolve(),
      fail: (error) =>
        reject(
          new ApiError(
            /cancel/i.test(error.errMsg || '')
              ? '已取消支付。'
              : `支付没有完成（${error.errCode}），请重试。`,
            'PAY_FAILED',
          ),
        ),
    });
  });
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * 购买会员：云端下单并签名 → 拉起支付 → 等微信的发货推送让会员生效。
 * 返回最新的会员状态；等了一阵还没生效时 info.until 不变，由页面提示稍后刷新。
 */
export async function buyVip(planId: string): Promise<VipInfo> {
  const before = await getVip();
  const { code } = await wx.login();
  const order = await callApi<VipOrder>('vip.order', { plan: planId, code });
  await requestPayment(order);
  let info = before;
  for (let i = 0; i < POLL_TIMES; i++) {
    await wait(POLL_GAP_MS);
    info = await getVip();
    if (info.until > before.until) break;
  }
  // 设置页等处读的是小家信息里的会员状态，顺手刷新。
  await getHousehold(true);
  return info;
}
