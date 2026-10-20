import { initializeCloud } from './services/cloud';
App({
  onLaunch() {
    try {
      initializeCloud();
    } catch {
      /* 各页面调用云函数时会显示具体错误。 */
    }
  },
});
