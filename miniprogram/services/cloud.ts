import { localConfig } from '../config/local';
import { noteWrite } from './snapshot';

let initialized = false;

// 只读不写的 action；其余都算写，成功后各 tab 切回时重新读取。
const READ_ONLY = /\.(get|list|parse|match|export)$/;

export class ApiError extends Error {
  constructor(
    message: string,
    public code = '',
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
  } catch {
    throw new ApiError(
      '网络或云端暂时不可用，操作没有完成，请重试。',
      'NETWORK',
    );
  }
  const result = raw as {
    ok?: boolean;
    data?: T;
    code?: string;
    message?: string;
  } | null;
  if (!result || result.ok !== true)
    throw new ApiError(
      result?.message || '云端返回异常，请重试。',
      result?.code || 'UNKNOWN',
    );
  if (!READ_ONLY.test(action)) noteWrite();
  return result.data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作没有完成，请重试。';
}
