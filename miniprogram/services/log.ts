/**
 * 线上出错时记到微信「实时日志」（小程序后台 → 开发管理 → 运维中心 → 实时日志），
 * 用来发现截图识别、AI 这类不稳定的地方。只记出错的位置、action 和错误码，不记账目内容和名字。
 */
type Detail = Record<string, string | number>;

let manager: WechatMiniprogram.RealtimeLogManager | null | undefined;

function logger(): WechatMiniprogram.RealtimeLogManager | null {
  if (manager === undefined)
    manager = wx.getRealtimeLogManager ? wx.getRealtimeLogManager() : null;
  return manager;
}

export function reportError(where: string, detail: Detail): void {
  console.warn(where, detail);
  logger()?.error(where, detail);
}

export function reportWarn(where: string, detail: Detail): void {
  console.warn(where, detail);
  logger()?.warn(where, detail);
}

/** 未捕获的错误只留第一行、截到 200 字。 */
export function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0].slice(0, 200);
}
