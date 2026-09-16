import { uiCopy } from '../../config/ui-copy';
import { resolvePhotoUrl } from '../../services/photo-url';
Component({
  properties: {
    src: String,
    caption: String,
    placeholder: { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
    ratio: { type: String, value: 'portrait' },
    adaptive: { type: Boolean, value: true },
  },
  data: {
    copy: uiCopy.photoFrame,
    failed: false,
    loaded: false,
    displaySrc: '',
    attempt: 0,
    visible: true,
    failureHint: '',
    frameStyle: '',
    resolvedRatio: '',
  },
  observers: {
    src(source: string) {
      this.setData({
        failed: false,
        loaded: false,
        failureHint: '',
        frameStyle: '',
        resolvedRatio: '',
      });
      if (!source) {
        this.setData({ displaySrc: '' });
        return;
      }
      void this.resolve(source);
    },
  },
  methods: {
    async resolve(source: string) {
      try {
        const displaySrc = await resolvePhotoUrl(source);
        if (this.data.src === source)
          this.setData({ displaySrc, failed: false });
      } catch (error) {
        console.error('[photo-frame] 无法取得云端图片链接', error);
        if (this.data.src === source) this.error('link');
      }
    },
    load(event?: WechatMiniprogram.BaseEvent) {
      const rawEvent = event as unknown as
        { detail?: { width?: number; height?: number } } | undefined;
      const size = rawEvent?.detail;
      const width = Number(size?.width);
      const height = Number(size?.height);
      const canAdapt = this.data.adaptive && width > 0 && height > 0;
      const frameStyle = canAdapt
        ? 'padding-top: ' +
          Math.min(160, Math.max(55, (height / width) * 100)).toFixed(2) +
          '%;'
        : '';
      const resolvedRatio = !canAdapt
        ? ''
        : width / height >= 1.1
          ? 'landscape'
          : height / width >= 1.1
            ? 'portrait'
            : 'square';
      this.setData({
        loaded: true,
        failed: false,
        frameStyle,
        resolvedRatio,
      });
    },
    error(kind: 'link' | 'load' = 'load') {
      this.setData({
        failed: true,
        loaded: false,
        failureHint:
          kind === 'link' ? uiCopy.photoFrame.text07 : uiCopy.photoFrame.text08,
      });
    },
    retry() {
      this.setData({
        failed: false,
        loaded: false,
        visible: false,
        failureHint: '',
        frameStyle: '',
        resolvedRatio: '',
      });
      void this.resolve(this.data.src);
      wx.nextTick(() => this.setData({ visible: true }));
    },
    open() {
      this.triggerEvent('open');
    },
  },
});
