import { localConfig } from '../config/local';
import { noteWrite } from './snapshot';
import { reportWarn } from './log';

let initialized = false;

// 只读不写的 action；其余都算写，成功后回到各页时重新读取。
const READ_ONLY = /\.(get|list|parse|match|export|tips)$/;
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
  if (!wx.cloud) throw new ApiError('当前微信版本不支持云开发，请升级后重试。');
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
      '网络或云端暂时不可用，操作没有完成，请重试。',
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
    throw new ApiError(result?.message || '云端返回异常，请重试。', code);
  }
  if (!READ_ONLY.test(action)) noteWrite();
  return result.data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作没有完成，请重试。';
}
