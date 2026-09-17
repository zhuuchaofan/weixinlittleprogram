import { getPublishedPhotos } from '../../services/photos';
import { uiCopy } from '../../config/ui-copy';
import { appConfig, storyItems } from '../../services/content';
import { previewPhotos } from '../../utils/preview';
Page({
  data: { copy: uiCopy.story, appConfig, storyItems },
  async onShow() {
    const photos = await getPublishedPhotos();
    if (photos !== null)
      this.setData({
        storyItems: storyItems.map((item, i) => ({
          ...item,
          photos: i === 0 ? photos.filter((p) => p.slot === 'story') : [],
        })),
      });
  },
  preview(event: WechatMiniprogram.CustomEvent) {
    const { story, photo } = event.currentTarget.dataset;
    const item = this.data.storyItems[Number(story)];
    if (item) previewPhotos(item.photos, Number(photo));
  },
});
