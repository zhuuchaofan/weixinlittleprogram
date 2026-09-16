import { uiCopy } from '../../config/ui-copy';
import { resolvePhotoUrl } from '../../services/photo-url';
Component({
  properties: {
    src: String,
    caption: String,
    placeholder: { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
    ratio: { type: String, value: 'portrait' },
  },
  data: {
    copy: uiCopy.photoFrame,
    failed: false,
    loaded: false,
    displaySrc: '',
    attempt: 0,
    visible: true,
  },
  observers: {
    src(source: string) {
      this.setData({ failed: false, loaded: false });
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
      } catch {
        if (this.data.src === source) this.error();
      }
    },
    load() {
      this.setData({ loaded: true, failed: false });
    },
    error() {
      this.setData({ failed: true, loaded: false });
    },
    retry() {
      this.setData({ failed: false, loaded: false, visible: false });
      void this.resolve(this.data.src);
      wx.nextTick(() => this.setData({ visible: true }));
    },
    open() {
      this.triggerEvent('open');
    },
  },
});
