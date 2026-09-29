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

module.exports = { invocationFromContext };
