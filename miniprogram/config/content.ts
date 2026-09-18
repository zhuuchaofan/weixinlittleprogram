import type { Album, Photo, StoryItem } from '../models';

// 唯一婚宴内容入口。坐标来自高德地图 POI（GCJ-02）。
export const appConfig = {
  brand: '欢迎参加我们的答谢宴',
  subtitle: '记录两个人、两只猫和许多好日子的纪念册。',
  names: '朱超凡&高佳益',
  headline: '把平凡的日子\n过成我们的故事。',
  introduction: '一屋，两人，三餐，四季。\n还有球球和布丁，和想见面的你。',
  invitation:
    '我们定于 2026 年 9 月 28 日举办结婚答谢宴，\n诚挚邀请大家前来相聚。',
  date: '2026.09.28',
  eventDate: '2026-09-28',
  collectionCloseDate: '2026-09-29',
  dateNote: '2026 年 9 月 28 日 · 结婚答谢宴',
  confirmed: true,
  time: '11:58',
  lunarDate: '',
  venue: '宴长安·西安菜（临潼华清宫景区店）',
  hall: '',
  address: '陕西省西安市临潼区人民西路 8 号',
  location: { latitude: 34.375565, longitude: 109.204275 },
  parents: '',
  tips: [
    '请在出发前确认最终时间与地点。',
    '答谢宴结束前可修改登记；9 月 29 日起仅可查看或删除已有内容。',
    '有饮食偏好可简单备注，请勿填写健康病史等敏感信息。',
  ],
  cats: ['球球', '布丁'],
  catMessage: '球球负责把阳光留住，布丁负责把日子过甜。',
  storyIntro:
    '大事和小事，都值得留一页。\n把一路的陪伴，和此刻的欢喜，慢慢讲给你听。',
  galleryIntro: '不急着翻完，日子还有很长。',
  // 提审前替换为实际可用的微信号；不要在这里填写密码、身份证或其他敏感信息。
  privacyContact: {
    channel: '微信号',
    account: 'zhuochaofan',
  },
  retention:
    '这份回复只为安排这次相聚而保留。2026 年 9 月 29 日起不再接受新增或修改；我们会在宴会结束后 90 天内手动删除到场登记和私密祝福，系统不会自动清理。你不必等到那时，随时都可以删除自己的回复或祝福。',
};

const photo = (
  id: string,
  fileName: string,
  caption: string,
  ratio: Photo['ratio'] = 'portrait',
): Photo => ({
  id,
  // 当前仅上传原图，先将同一 File ID 用于缩略图与大图；后续可单独上传 thumb 再替换 thumbnail。
  thumbnail:
    'cloud://cloud1-d1grwmf5a71be2fa7.636c-cloud1-d1grwmf5a71be2fa7-1489720558/wedding/original/' +
    fileName,
  original:
    'cloud://cloud1-d1grwmf5a71be2fa7.636c-cloud1-d1grwmf5a71be2fa7-1489720558/wedding/original/' +
    fileName,
  caption,
  placeholder: false,
  ratio,
});
const weddingPhotos: Photo[] = [
  photo('wedding-01', '2026-09-16 190600_20260916_222905.jpg', '婚纱照 01'),
  photo('wedding-02', '2026-09-16 185844.jpg', '婚纱照 02'),
  photo('wedding-03', '2026-09-16 185300_20260916_222731.jpg', '婚纱照 03'),
  photo('wedding-04', '2026-09-16 184633_20260916_222817.jpg', '婚纱照 04'),
  photo('wedding-05', '2026-09-16 184214_20260916_222758.jpg', '婚纱照 05'),
  photo('wedding-06', '2026-09-16 184114.jpg', '婚纱照 06'),
  photo('wedding-07', '2026-09-16 183908_20260916_222758.jpg', '婚纱照 07'),
  photo('wedding-08', '2026-09-16 183419.jpg', '婚纱照 08'),
];
export const coverPhoto: Photo = {
  ...weddingPhotos[5],
  id: 'cover',
  caption: '答谢宴前的我们',
};
export const storyItems: StoryItem[] = [
  {
    id: 'wedding',
    date: 'CHAPTER 01 · 2026.09.28',
    title: '把这一刻，好好收藏',
    description: '答谢宴之前，我们先把这一页留给彼此。',
    photos: weddingPhotos.slice(0, 3),
  },
];
export const albums: Album[] = [
  {
    id: 'wedding-photos',
    title: '婚纱照',
    description: '把这一刻，留在光里',
    photos: weddingPhotos,
  },
];
export const navigation = [
  {
    title: '电子请柬',
    description: '把这一天，留给相聚',
    url: '/pages/invitation/index',
    number: '01',
  },
  {
    title: '我们的故事',
    description: '从遇见到每一天',
    url: '/pages/story/index',
    number: '02',
  },
  {
    title: '照片册',
    description: '一些舍不得快进的瞬间',
    url: '/pages/gallery/index',
    number: '03',
  },
  {
    title: '到场登记',
    description: '告诉我们，你的安排',
    url: '/pages/rsvp/index',
    number: '04',
  },
];

// 后续替换为球球、布丁的云存储 File ID，并将 placeholder 改为 false。
export const catPhotos: Photo[] = [
  {
    id: 'qiuqiu',
    thumbnail: '',
    original: '',
    caption: '球球',
    placeholder: true,
    ratio: 'square',
  },
  {
    id: 'buding',
    thumbnail: '',
    original: '',
    caption: '布丁',
    placeholder: true,
    ratio: 'square',
  },
];
