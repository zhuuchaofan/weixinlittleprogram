import type { CloudFileRendition } from '../../services/cloud-file-url';
import { uiCopy } from '../../config/ui-copy';
import { invalidatePhotoUrl, resolvePhotoUrl } from '../../services/photo-url';

type Slot = 'a' | 'b';

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
    activeSlot: 'a' as Slot,
    currentSource: '',
    pendingSource: '',
    pendingSlot: '' as Slot | '',
    pendingVersion: 0,
    pendingRendition: 'thumbnail' as CloudFileRendition,
    slotASource: '',
    slotAUrl: '',
    slotBSource: '',
    slotBUrl: '',
    failureHint: '',
    frameStyle: '',
    resolvedRatio: '',
  },
  observers: {
    src(source: string) {
      this.receive(source || '');
    },
  },
  methods: {
    receive(source: string) {
      if (!source) {
        this.setData({
          failed: false,
          loaded: false,
          activeSlot: 'a',
          currentSource: '',
          pendingSource: '',
          pendingSlot: '',
          pendingVersion: this.data.pendingVersion + 1,
          slotASource: '',
          slotAUrl: '',
          slotBSource: '',
          slotBUrl: '',
          failureHint: '',
          frameStyle: '',
          resolvedRatio: '',
        });
        return;
      }

      if (source === this.data.currentSource) {
        if (this.data.pendingSource)
          this.setData({
            pendingSource: '',
            pendingSlot: '',
            pendingVersion: this.data.pendingVersion + 1,
            failed: false,
            failureHint: '',
          });
        return;
      }
      if (source === this.data.pendingSource) return;
      void this.stage(source, false);
    },
    async stage(
      source: string,
      force: boolean,
      rendition: CloudFileRendition = 'thumbnail',
    ) {
      if (!source || (!force && source === this.data.currentSource)) return;

      const slot: Slot = this.data.activeSlot === 'a' ? 'b' : 'a';
      const pendingVersion = this.data.pendingVersion + 1;
      const hasCurrent = Boolean(this.data.currentSource && this.data.loaded);
      this.setData({
        pendingSource: source,
        pendingSlot: slot,
        pendingVersion,
        pendingRendition: rendition,
        failed: false,
        failureHint: '',
        ...(slot === 'a'
          ? { slotASource: '', slotAUrl: '' }
          : { slotBSource: '', slotBUrl: '' }),
        ...(hasCurrent
          ? {}
          : { loaded: false, frameStyle: '', resolvedRatio: '' }),
      });

      try {
        const url = await resolvePhotoUrl(source, rendition);
        if (
          this.data.pendingVersion !== pendingVersion ||
          this.data.pendingSlot !== slot ||
          this.data.pendingSource !== source ||
          this.data.src !== source
        )
          return;
        this.setData(
          slot === 'a'
            ? { slotASource: source, slotAUrl: url }
            : { slotBSource: source, slotBUrl: url },
        );
      } catch (error) {
        console.error('[photo-frame] 无法取得云端图片链接', error);
        if (this.data.pendingVersion === pendingVersion)
          this.failPending(slot, source, 'link');
      }
    },
    loadA(event?: WechatMiniprogram.BaseEvent) {
      this.promote('a', event);
    },
    loadB(event?: WechatMiniprogram.BaseEvent) {
      this.promote('b', event);
    },
    // 供测试与兼容旧调用使用；真实图片分别由 loadA / loadB 处理。
    load(event?: WechatMiniprogram.BaseEvent) {
      const slot = this.data.pendingSlot || this.data.activeSlot;
      this.promote(slot, event);
    },
    promote(slot: Slot, event?: WechatMiniprogram.BaseEvent) {
      if (!this.isCurrentImageEvent(slot, event)) return;
      const source =
        slot === 'a' ? this.data.slotASource : this.data.slotBSource;
      if (
        !source ||
        this.data.pendingSlot !== slot ||
        this.data.pendingSource !== source ||
        this.data.src !== source
      )
        return;

      const rawEvent = event as unknown as
        { detail?: { width?: number; height?: number } } | undefined;
      const width = Number(rawEvent?.detail?.width);
      const height = Number(rawEvent?.detail?.height);
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
        activeSlot: slot,
        currentSource: source,
        pendingSource: '',
        pendingSlot: '',
        loaded: true,
        failed: false,
        failureHint: '',
        frameStyle,
        resolvedRatio,
      });
    },
    isCurrentImageEvent(
      slot: Slot,
      event?: WechatMiniprogram.BaseEvent,
    ): boolean {
      const url = event?.currentTarget?.dataset?.url;
      return (
        !url || url === (slot === 'a' ? this.data.slotAUrl : this.data.slotBUrl)
      );
    },
    errorA(event?: WechatMiniprogram.BaseEvent) {
      if (this.isCurrentImageEvent('a', event))
        this.failPending('a', this.data.slotASource, 'load');
    },
    errorB(event?: WechatMiniprogram.BaseEvent) {
      if (this.isCurrentImageEvent('b', event))
        this.failPending('b', this.data.slotBSource, 'load');
    },
    // 供测试与兼容旧调用使用；仅当前等待中的图片能进入失败状态。
    error(kind: 'link' | 'load' = 'load') {
      const slot = this.data.pendingSlot || this.data.activeSlot;
      const source =
        slot === 'a' ? this.data.slotASource : this.data.slotBSource;
      this.failPending(slot, source, kind);
    },
    failPending(slot: Slot, source: string, kind: 'link' | 'load') {
      if (
        !source ||
        this.data.pendingSlot !== slot ||
        this.data.pendingSource !== source ||
        this.data.src !== source
      )
        return;

      // WebP 解码或处理服务不可用时逐级回退；每级只尝试一次。
      if (
        kind === 'load' &&
        source.startsWith('cloud://') &&
        this.data.pendingRendition !== 'original'
      ) {
        const next =
          this.data.pendingRendition === 'thumbnail'
            ? 'thumbnail-compatible'
            : 'original';
        void this.stage(source, true, next);
        return;
      }
      const message =
        kind === 'link' ? uiCopy.photoFrame.text07 : uiCopy.photoFrame.text08;
      if (this.data.currentSource) {
        this.setData({
          pendingSource: '',
          pendingSlot: '',
          failed: false,
          failureHint: '',
        });
        return;
      }
      this.setData({
        pendingSource: '',
        pendingSlot: '',
        failed: true,
        loaded: false,
        failureHint: message,
      });
    },
    retry() {
      const source = this.data.src;
      if (!source) return;
      invalidatePhotoUrl(source);
      this.setData({ failed: false, failureHint: '' });
      void this.stage(source, true);
    },
    open() {
      this.triggerEvent('open');
    },
  },
});
