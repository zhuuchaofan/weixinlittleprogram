import { fitsPhotoRequest } from './photo-upload';
import { uiCopy } from '../config/ui-copy';
import { localConfig } from '../config/local';
let initialized = false;
export class CloudRequestError extends Error {
  constructor(
    message: string,
    public diagnostic: string,
  ) {
    super(message);
  }
}
export class CloudActionError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function cloudDiagnostic(
  error: unknown,
  action: string,
  data: unknown,
): string {
  const detail = (error || {}) as {
    errCode?: unknown;
    errMsg?: unknown;
    message?: unknown;
  };
  const clean = String(detail.errMsg || detail.message || '无详细错误')
    .replace(/(?:https?:\/\/|cloud:\/\/)[^\s"']+/g, '[地址已隐藏]')
    .replace(/[A-Za-z0-9+/_=-]{80,}/g, '[长数据已隐藏]')
    .replace(
      /(openid|token|authorization|secret)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[已隐藏]',
    )
    .slice(0, 700);
  return JSON.stringify(
    {
      time: new Date().toISOString(),
      action,
      requestCharacters: JSON.stringify({ action, payload: data }).length,
      code: String(detail.errCode ?? 'unknown').slice(0, 24),
      detail: clean,
    },
    null,
    2,
  );
}

export function cloudFailureMessage(error: unknown): string {
  const detail = (error || {}) as {
    errCode?: unknown;
    errMsg?: unknown;
    message?: unknown;
  };
  const raw = String(detail.errMsg || detail.message || '');
  const code = String(detail.errCode ?? '').match(/^-?[0-9]{1,12}$/)?.[0];
  const suffix = code ? `（错误码：${code}）` : '';
  if (/exceed.*size|too large|payload.*limit|max.*size/i.test(raw))
    return (
      '上传请求超过调用链路限制，请复制诊断详情以便调整上传方式。' + suffix
    );
  if (/timeout|timed out|time limit|超时/i.test(raw))
    return (
      '云端请求超时，尚未确认操作结果。请检查 weddingApi 的执行日志和超时配置，确认云存储是否已有文件后再重试。' +
      suffix
    );
  if (/permission|unauthoriz|access.?denied|权限/i.test(raw))
    return '云端调用被拒绝，请检查云函数调用权限和当前环境。' + suffix;
  return uiCopy.cloud.text03 + suffix;
}

export function initializeCloud(): void {
  if (!localConfig.cloudEnvId.trim()) throw new Error(uiCopy.cloud.text01);
  if (!wx.cloud) throw new Error(uiCopy.cloud.text02);
  if (!initialized) {
    wx.cloud.init({ env: localConfig.cloudEnvId, traceUser: false });
    initialized = true;
  }
}
export async function callCloud<T>(
  action: string,
  data: unknown = {},
): Promise<T> {
  if (action === 'uploadPhoto') {
    const base64 = (data as { base64?: unknown })?.base64;
    if (typeof base64 !== 'string' || !fitsPhotoRequest(base64))
      throw new Error('照片请求超过本地安全上限，尚未发送，请压缩后重试。');
  }
  initializeCloud();
  let raw: unknown;
  try {
    const response = await wx.cloud.callFunction({
      name: 'weddingApi',
      data: { action, payload: data },
    });
    raw = response.result;
  } catch (error) {
    throw new CloudRequestError(
      cloudFailureMessage(error),
      cloudDiagnostic(error, action, data),
    );
  }
  const result = raw as {
    ok: boolean;
    data: T;
    code?: string;
    message?: string;
  };
  if (!result || result.ok !== true)
    throw new CloudActionError(
      result?.message || uiCopy.cloud.text04,
      result?.code,
    );
  return result.data;
}
