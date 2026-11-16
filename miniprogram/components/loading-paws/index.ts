/**
 * 加载中：走路的猫爪印 + 一句话（默认「正在读取…」）。样式 .status、.status-paws 在 app.wxss。
 * 用法：<loading-paws wx:if="{{loading}}" theme-id="{{themeId}}" />，猫爪印跟主题变色。
 */
Component({
  // 不要外层节点：页面里和原来直接写 <view class="status"> 一样排版。
  options: { virtualHost: true },
  properties: {
    themeId: { type: String, value: '' },
    text: { type: String, value: '正在读取…' },
  },
});
