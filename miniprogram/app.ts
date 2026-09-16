import { localConfig } from './config/local';
import { initializeCloud } from './services/cloud';
App({
  onLaunch() {
    if (localConfig.mode === 'cloud' && localConfig.cloudEnvId) {
      try {
        initializeCloud();
      } catch {
        /* 首屏仍可阅读本地内容；照片框及登记 service 分别显示失败状态。 */
      }
    }
  },
});
