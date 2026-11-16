// 云函数的 Node 版本可能没有全局 fetch。@cloudbase/js-sdk 在不是小程序发起的调用里
// （定时触发器、控制台测试、虚拟支付发货/退款推送）直接调全局 fetch 连数据库，
// 没有就报「fetch is not defined」。这里在加载 SDK 之前用 node-fetch 补上。
if (typeof globalThis.fetch !== 'function') {
  const nodeFetch = require('node-fetch');
  globalThis.fetch = nodeFetch;
  for (const name of ['Headers', 'Request', 'Response']) {
    if (typeof globalThis[name] !== 'function') globalThis[name] = nodeFetch[name];
  }
}
