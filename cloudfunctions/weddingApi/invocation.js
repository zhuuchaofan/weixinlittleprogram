function invocationFromContext(context, parseContext, fallbackEnv = '') {
  try {
    // 身份仅来自本次调用；实例环境变量可能残留上次调用的 WX_OPENID。
    const parsed = parseContext(context);
    const environment = parsed.environment || parsed.environ || {};
    return {
      openid:
        typeof environment.WX_OPENID === 'string' ? environment.WX_OPENID : '',
      envId:
        typeof environment.TCB_ENV === 'string'
          ? environment.TCB_ENV
          : fallbackEnv,
    };
  } catch {
    return { openid: '', envId: fallbackEnv };
  }
}

function cloudConfigForInvocation(envId, runtimeEnv = process.env) {
  const secretId = runtimeEnv.TENCENTCLOUD_SECRETID;
  const secretKey = runtimeEnv.TENCENTCLOUD_SECRETKEY;
  const sessionToken = runtimeEnv.TENCENTCLOUD_SESSIONTOKEN;
  return {
    env: envId,
    // 微信事件云函数沿用 /admin 通道，避免新版默认切换到 HTTP 网关。
    endPointMode: 'CLOUD_API',
    ...(runtimeEnv.TENCENTCLOUD_REGION
      ? { region: runtimeEnv.TENCENTCLOUD_REGION }
      : {}),
    ...(secretId && secretKey
      ? {
          // 事件云函数的临时密钥可能随调用轮换，优先使用当次运行时凭据。
          auth: {
            secretId,
            secretKey,
            ...(sessionToken
              ? { sessionToken, secretType: 'SESSION_SECRET' }
              : {}),
          },
        }
      : {}),
  };
}

module.exports = { invocationFromContext, cloudConfigForInvocation };
