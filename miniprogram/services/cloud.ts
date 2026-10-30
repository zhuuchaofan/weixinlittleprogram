import { localConfig } from '../config/local';
import { noteWrite } from './snapshot';
import { reportWarn } from './log';

let initialized = false;

// 只读不写的 action；其余都算写，成功后回到各页时重新读取。
const READ_ONLY = /\.(get|list|parse|match|export|tips|clearCount)$/;
// 这些是用户自己能处理的提示（填错、次数用完、还没加入小家），不算出错，不上报。
const EXPECTED = [
  'VALIDATION',
  'LIMIT',
  'NO_HOUSEHOLD',
  'NOT_FOUND',
  'ALREADY_MEMBER',
  'ALREADY_SETTLED',
  'INVALID_CODE',
  'TOO_MANY',
  'PARTNER_LEFT',
  'BUSY',
];

export class ApiError extends Error {
  constructor(
    message: string,
    public code = '',
    /** 微信返回的原始错误（只有网络类错误才有），排查用，不当提示直接给用户看。 */
    public detail = '',
  ) {
    super(message);
  }
}

export function initializeCloud(): void {
  if (!localConfig.cloudEnvId.trim())
    throw new ApiError('云环境尚未配置，请在 config/local.ts 填写环境 ID。');
  if (!wx.cloud) throw new ApiError('微信版本有点旧，升级一下再来吧。');
  if (!initialized) {
    wx.cloud.init({ env: localConfig.cloudEnvId, traceUser: false });
    initialized = true;
  }
}

/** 所有数据读写的唯一出口：云函数 api。 */
export async function callApi<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  initializeCloud();
  let raw: unknown;
  try {
    const response = await wx.cloud.callFunction({
      name: 'api',
      data: { action, payload },
    });
    raw = response.result;
  } catch (error) {
    reportWarn('api', { action, code: 'NETWORK' });
    throw new ApiError(
      '网络好像开小差了，刚才没完成，稍后再试一次吧。',
      'NETWORK',
      String((error as { errMsg?: string })?.errMsg || error || ''),
    );
  }
  const result = raw as {
    ok?: boolean;
    data?: T;
    code?: string;
    message?: string;
  } | null;
  if (!result || result.ok !== true) {
    const code = result?.code || 'UNKNOWN';
    if (!EXPECTED.includes(code)) reportWarn('api', { action, code });
    throw new ApiError(
      result?.message || '喵喵没接住这一下，再试一次吧。',
      code,
    );
  }
  if (!READ_ONLY.test(action)) noteWrite();
  return result.data as T;
}

/**
 * 给人看的提示：云端和我们自己写的提示（ApiError）原样显示；程序里的意外错误
 * （例如「Cannot read properties of undefined」）不给人看原文，换成一句温和的话并上报。
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  reportWarn('ui', {
    code: 'UNEXPECTED',
    message: String((error as Error)?.message || error).slice(0, 80),
  });
  return '出了点小意外，下拉刷新或者再试一次吧。';
}
