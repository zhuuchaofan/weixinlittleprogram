type PrivacyApi = {
  requirePrivacyAuthorize?: (options: {
    success?: () => void;
    fail?: (error: unknown) => void;
  }) => void;
  openPrivacyContract?: (options: {
    success?: () => void;
    fail?: (error: unknown) => void;
  }) => void;
};

function api(): PrivacyApi {
  return wx as unknown as PrivacyApi;
}

function nativeCall(
  method: keyof PrivacyApi,
  unsupportedMessage: string,
): Promise<void> {
  const fn = api()[method];
  if (typeof fn !== 'function')
    return Promise.reject(new Error(unsupportedMessage));
  return new Promise((resolve, reject) => {
    fn({ success: resolve, fail: reject });
  });
}

/**
 * 仅在管理员主动点选照片时调用。微信会按公众平台已配置的隐私指引展示原生授权，
 * 拒绝后不会继续打开相册或上传任何文件。
 */
export async function ensurePhotoSelectionAuthorization(): Promise<void> {
  try {
    await nativeCall(
      'requirePrivacyAuthorize',
      '当前微信版本暂不支持隐私授权，请升级微信后再添加照片。',
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('当前微信版本'))
      throw error;
    throw new Error('未获得照片选择授权，本次未选择或上传照片。');
  }
}

export async function openPlatformPrivacyGuide(): Promise<void> {
  try {
    await nativeCall(
      'openPrivacyContract',
      '当前微信版本暂不能打开平台隐私保护指引，请升级微信后重试。',
    );
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('暂时无法打开平台隐私保护指引，请稍后重试。');
  }
}
