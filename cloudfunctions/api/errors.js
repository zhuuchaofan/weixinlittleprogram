class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function failure(error) {
  // 不记录请求体、OpenID 或业务内容。
  if (error instanceof ApiError)
    return { ok: false, code: error.code, message: error.message };
  return {
    ok: false,
    code: 'INTERNAL',
    message: '喵喵这边出了点小状况，稍等一会儿再试试。',
  };
}

module.exports = { ApiError, failure };
