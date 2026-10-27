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
      fail: (error) => {
        // 原样打出微信的说明，方便对照错误码表排查（-15001 参数错误、-15006 paySig 错等）。
        console.warn('requestVirtualPayment fail', error, order.signData);
        const detail = (error.errMsg || '').replace(
          /^requestVirtualPayment:fail\s*/,
          '',
        );
        reject(
          new ApiError(
            /cancel/i.test(error.errMsg || '')
              ? '已取消支付。'
              : `支付没有完成（${error.errCode}${detail ? `：${detail}` : ''}），请重试。`,
            'PAY_FAILED',
          ),
        );
      },
    });
  });
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface VipConfirm {
  delivered: boolean;
  active: boolean;
  until: number;
}

/**
 * 购买会员：云端下单并签名 → 拉起支付 → 让云端向微信查单开通。
 * 不只等发货推送（沙箱不发推送，现网也可能丢）。返回最新的会员状态；
 * 等了一阵还没到账时 info.until 不变，由页面提示稍后刷新。
 */
export async function buyVip(planId: string): Promise<VipInfo> {
  const before = await getVip();
  const { code } = await wx.login();
  const order = await callApi<VipOrder>('vip.order', { plan: planId, code });
  const { outTradeNo } = JSON.parse(order.signData) as { outTradeNo: string };
  await requestPayment(order);
  let info = before;
  for (let i = 0; i < POLL_TIMES; i++) {
    await wait(POLL_GAP_MS);
    try {
      const result = await callApi<VipConfirm>('vip.confirm', { outTradeNo });
      info = { ...info, active: result.active, until: result.until };
      if (result.delivered) break;
    } catch {
      // 查单偶尔失败不要紧，下一轮再查；发货推送也会补上。
    }
  }
  // 设置页等处读的是小家信息里的会员状态，顺手刷新。
  await getHousehold(true);
  return info;
}
