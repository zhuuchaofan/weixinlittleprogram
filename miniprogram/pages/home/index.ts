import { getReduceMotion } from '../../services/motion-preference';
import type { EventProgram, Photo } from '../../models';
import {
  getPublishedPhotos,
  photoArrangementSignature,
} from '../../services/photos';
import { uiCopy } from '../../config/ui-copy';
import {
  appConfig,
  coverPhoto,
  navigation,
  catPhotos,
  defaultEventProgram,
} from '../../services/content';
import { isMock } from '../../services/rsvp';
import { getBanquetStatus } from '../../utils/event-phase';
import { isCollectionClosed } from '../../utils/collection-phase';
import { previewPhotos } from '../../utils/preview';
import { prewarmPhotoUrls } from '../../services/photo-url';
import { openVenueLocation } from '../../services/venue-location';
import { musicService } from '../../services/music';
import { eventProgramService } from '../../services/event-program';

let homeRefreshVersion = 0;
let programRefreshVersion = 0;

function programSignature(program: EventProgram): string {
  return JSON.stringify(program);
}

function createCatColumns(
  photos: Photo[],
): Array<{ id: string; photos: Photo[] }> {
  const columns = [
    { id: 'cat-column-0', photos: [] as Photo[] },
    { id: 'cat-column-1', photos: [] as Photo[] },
  ];
  photos.forEach((photo, index) =>
    columns[index % columns.length].photos.push(photo),
  );
  return columns;
}

function homePhotoState(photos: Array<Photo & { slot?: string }> | null) {
  if (!photos) return { cover: coverPhoto, cats: catPhotos };
  return {
    cover: photos.find((photo) => photo.slot === 'cover') || {
      ...coverPhoto,
      thumbnail: '',
      original: '',
      placeholder: true,
    },
    cats: catPhotos.flatMap<Photo>((cat) => {
      const published = photos.filter((photo) => photo.slot === cat.id);
      return published.length
        ? published
        : [{ ...cat, thumbnail: '', original: '', placeholder: true }];
    }),
  };
}

Page({
  data: {
    copy: uiCopy.home,
    appConfig,
    coverPhoto,
    catPhotos: [] as Photo[],
    catColumns: createCatColumns([]),
    navigation: navigation.filter(
      (item) =>
        item.url === '/pages/invitation/index' ||
        item.url === '/pages/story/index',
    ),
    isMock,
    reduceMotion: true,
    catVisible: false,
    photoContentReady: false,
    photoSignature: '',
    banquetScene: false,
    eventStatus: getBanquetStatus(appConfig.eventDate),
    collectionClosed: isCollectionClosed(appConfig.collectionCloseDate),
    eventProgram: defaultEventProgram,
    visibleProgramItems: defaultEventProgram.items.filter(
      (item) => item.visible,
    ),
    programReady: false,
    programSignature: '',
  },
  onLoad(options: Record<string, string | undefined> = {}) {
    this.setData({ banquetScene: options.scene === 'banquet' });
  },
  async onShow() {
    void musicService.autoStart();
    void this.refreshProgram();
    const reduceMotion = getReduceMotion();
    const eventStatus = getBanquetStatus(appConfig.eventDate);
    const collectionClosed = isCollectionClosed(appConfig.collectionCloseDate);
    if (eventStatus.phase === 'today') void this.refreshProgram();
    if (
      this.data.reduceMotion !== reduceMotion ||
      this.data.eventStatus.phase !== eventStatus.phase ||
      this.data.eventStatus.daysUntil !== eventStatus.daysUntil ||
      this.data.collectionClosed !== collectionClosed
    )
      this.setData({ reduceMotion, eventStatus, collectionClosed });

    const refreshVersion = ++homeRefreshVersion;
    const result = await getPublishedPhotos();
    if (refreshVersion !== homeRefreshVersion) return;
    if (result.state === 'unavailable' && this.data.photoContentReady) return;
    const state = homePhotoState(
      result.state === 'published'
        ? result.photos
        : result.state === 'missing'
          ? null
          : [],
    );
    const photoSignature = photoArrangementSignature([
      state.cover,
      ...state.cats,
    ]);
    if (
      !this.data.photoContentReady ||
      this.data.photoSignature !== photoSignature
    ) {
      void prewarmPhotoUrls(
        [state.cover, ...state.cats].map((photo) => photo.thumbnail),
      );
      this.setData({
        coverPhoto: state.cover,
        catPhotos: state.cats,
        catColumns: createCatColumns(state.cats),
        photoContentReady: true,
        photoSignature,
      });
    }
  },
  async refreshProgram() {
    const refreshVersion = ++programRefreshVersion;
    let eventProgram = defaultEventProgram;
    try {
      eventProgram = await eventProgramService.published();
    } catch {
      if (this.data.programReady) eventProgram = this.data.eventProgram;
    }
    if (refreshVersion !== programRefreshVersion) return;
    const signature = programSignature(eventProgram);
    if (!this.data.programReady || this.data.programSignature !== signature)
      this.setData({
        eventProgram,
        visibleProgramItems: eventProgram.items.filter((item) => item.visible),
        programReady: true,
        programSignature: signature,
      });
  },
  preview() {
    previewPhotos([this.data.coverPhoto], 0);
  },
  previewCat(event: WechatMiniprogram.CustomEvent) {
    const selected = this.data.catPhotos.find(
      (photo) => photo.id === event.currentTarget.dataset.id,
    );
    const available = this.data.catPhotos.filter(
      (photo) => !photo.placeholder && !!(photo.original || photo.thumbnail),
    );
    if (!selected || !available.includes(selected)) return;
    void previewPhotos(available, available.indexOf(selected));
  },
  map() {
    openVenueLocation();
  },
  enter() {
    wx.navigateTo({ url: '/pages/gallery/index' });
  },
  cat() {
    this.setData({ catVisible: !this.data.catVisible });
  },
  onShareAppMessage() {
    return { title: appConfig.brand, path: '/pages/home/index?scene=banquet' };
  },
});
