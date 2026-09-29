import {
  getPublishedMediaLibrary,
  initialMediaLibrary,
  photoArrangementSignature,
} from '../../services/photos';
import { uiCopy } from '../../config/ui-copy';
import { appConfig, storyItems } from '../../services/content';
import { previewPhotos } from '../../utils/preview';
import { prewarmPhotoUrls } from '../../services/photo-url';
import type { Photo } from '../../models';

let storyRefreshVersion = 0;

function storyPhotoState(photos: Photo[] | null) {
  return storyItems.map((item, index) => ({
    ...item,
    photos:
      index === 0
        ? (photos || initialMediaLibrary()).filter((photo) =>
            photo.placements?.includes('story'),
          )
        : [],
  }));
}

Page({
  data: {
    copy: uiCopy.story,
    appConfig,
    storyItems,
    photoContentReady: false,
    photoSignature: '',
  },
  async onShow() {
    const refreshVersion = ++storyRefreshVersion;
    const result = await getPublishedMediaLibrary();
    if (refreshVersion !== storyRefreshVersion) return;
    if (result.state === 'unavailable' && this.data.photoContentReady) return;

    const items = storyPhotoState(
      result.state === 'published'
        ? result.photos
        : result.state === 'missing'
          ? null
          : [],
    );
    const photoSignature = photoArrangementSignature(
      items.flatMap((item) => item.photos),
    );
    if (
      !this.data.photoContentReady ||
      this.data.photoSignature !== photoSignature
    ) {
      void prewarmPhotoUrls(
        items.flatMap((item) => item.photos).map((photo) => photo.thumbnail),
      );
      this.setData({
        storyItems: items,
        photoContentReady: true,
        photoSignature,
      });
    }
  },
  preview(event: WechatMiniprogram.CustomEvent) {
    const { story, photo } = event.currentTarget.dataset;
    const item = this.data.storyItems[Number(story)];
    if (item) previewPhotos(item.photos, Number(photo));
  },
});
