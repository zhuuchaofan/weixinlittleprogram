import {
  invalidateCloudFileUrl,
  resolveCloudFileUrl,
} from '../../services/cloud-file-url';

// 同一时刻仅允许一个媒体组件播放；隐藏、换源和销毁均释放。
let active: (() => void) | null = null;
Component({
  properties: {
    src: String,
    cover: String,
    caption: String,
    ratio: { type: String, value: 'landscape' },
  },
  data: { url: '', opened: false, loading: false, failed: false, version: 0 },
  observers: {
    src() {
      this.stop();
    },
  },
  pageLifetimes: {
    hide() {
      this.stop();
    },
  },
  lifetimes: {
    detached() {
      this.stop();
    },
  },
  methods: {
    stop() {
      if (this.data.opened) wx.createVideoContext('player', this).stop();
      if (active === this.stop) active = null;
      this.setData({
        opened: false,
        url: '',
        loading: false,
        version: this.data.version + 1,
      });
    },
    async open() {
      if (this.data.loading || !this.data.src) return;
      active?.();
      active = this.stop;
      const version = this.data.version + 1;
      this.setData({ loading: true, failed: false, version });
      try {
        invalidateCloudFileUrl(this.data.src);
        const url = await resolveCloudFileUrl(this.data.src, 'original');
        if (version !== this.data.version) return;
        this.setData({ url, opened: true, loading: false }, () => {
          if (version === this.data.version)
            wx.createVideoContext('player', this).play();
        });
      } catch {
        if (version === this.data.version)
          this.setData({ loading: false, failed: true });
      }
    },
    play() {
      if (active !== this.stop) {
        active?.();
        active = this.stop;
      }
    },
    error() {
      this.stop();
      this.setData({ failed: true });
    },
  },
});
