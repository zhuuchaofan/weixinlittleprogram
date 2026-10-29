import { AGREEMENT } from '../../config/agreement';
import { applyTheme, themeData } from '../../services/theme';

/** 会员服务协议：正文来自 docs/VIP-AGREEMENT.md（npm run agreement 生成），页面只负责排版。 */
Page({
  data: { ...themeData(), agreement: AGREEMENT },
  onShow() {
    applyTheme(this);
  },
});
