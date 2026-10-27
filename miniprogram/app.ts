import { initializeCloud } from './services/cloud';
import { reportError, shortError } from './services/log';
App({
  onLaunch() {
    try {
      initializeCloud();
    } catch {
      /* 各页面调用云函数时会显示具体错误。 */
    }
  },
  onError(message: string) {
    reportError('app', { error: shortError(message) });
  },
  onUnhandledRejection(result: { reason: unknown }) {
    reportError('promise', { error: shortError(result.reason) });
  },
});
