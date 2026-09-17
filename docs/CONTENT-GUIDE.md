# 如何换照片与文案

## 先找这两个文件

- `miniprogram/config/content.ts`：品牌、姓名、婚宴信息、故事、照片、首页目录。
- `miniprogram/config/ui-copy.ts`：按 `home / invitation / story / gallery / rsvp / admin / privacy` 等分组的界面文案。保留 `text01` 等键名，只修改右侧字符串。隐私正文和各状态提示也集中在这里。

无需改 WXML 或业务 service。系统原生导航标题在各页面 `index.json`；品牌变化时也同步 `app.json` 的标题。错误提示与隐私约定必须保持与实际功能一致；不要删除 mock 提示来冒充已上线。

## 1. 核对宴会信息

修改 `appConfig`：

| 字段                                   | 内容                                  |
| -------------------------------------- | ------------------------------------- |
| `brand / names`                        | 两猫一屋、新人姓名                    |
| `headline / introduction / invitation` | 首页标题、介绍、邀请文案，`\n` 可换行 |
| `date / dateNote / lunarDate / time`   | 公历、日期提示、农历、宴会时间        |
| `venue / hall / address`               | 酒店全称、楼层和厅名、详细地址        |
| `parents`                              | 父母敬邀署名                          |
| `tips`                                 | 温馨提示数组                          |
| `location`                             | 确认后的地图坐标；未确认保持 `null`   |
| `confirmed`                            | 确认全部婚宴信息后才改为 `true`       |
| `cats / catMessage`                    | 球球、布丁及轻触后的彩蛋              |
| `privacyContact / retention`           | 主人联系方法、实际保存期限与清理安排  |

地图坐标使用微信地图可接受的 GCJ-02 坐标，`latitude` 是纬度，`longitude` 是经度。不要使用示例坐标或把经纬度写反。

```ts
// 这里只展示结构；数值必须换成场地确认后的坐标。
location: null,
confirmed: false,
```

当前已填写为 2026 年 9 月 28 日 11:58 的结婚答谢宴，且没有父母署名；后续变更时同步改 `dateNote`，但不要凭空补农历。酒店已使用高德地图 POI 的 GCJ-02 坐标；若场地变更，再从地图分享链接重新核对。首页照片保持留白，信息不压在照片上。

## 2. 换封面或相册照片

所有 `Photo` 使用相同结构：

```ts
{
  id: 'travel-2026-01',             // 唯一且稳定
  thumbnail: '/assets/travel-01-thumb.jpg',
  original: '/assets/travel-01-large.jpg',
  caption: '在路上的某一天',
  placeholder: false,
  ratio: 'landscape',              // portrait / square / landscape
}
```

- 封面：替换 `coverPhoto`。
- 时间线：替换 `storyItems[].photos`，建议每章节 1–5 张。
- 分组相册：替换 `albums[].photos`，`id` 不要重复；数组顺序就是原生大图预览顺序。
- 本地路径必须以 `/assets/` 开头，图片放在 `miniprogram/assets/` 下。
- 少量照片可本地试验；完整相册建议用云存储，避免超过微信小程序包体限制。
- 云端照片将 `thumbnail` 和 `original` 分别换成云存储的 `cloud://...` 文件 ID。项目会在显示和大图预览时自动换成临时 HTTPS 地址；只保存 file ID，不保存临时 URL。外部 HTTPS 图需另外配置合法域名。
- 当前的 8 张婚纱照已接入 `wedding/original`，暂时将原图同时用于缩略图与大图。正式发出邀请前，建议另传压缩后的缩略图到 `wedding/thumb`，只替换各照片的 `thumbnail`。
- 图片框使用 `aspectFit`，会保留完整照片；图片加载后会按真实宽高自动调整相框，形成两列杂志式瀑布流。`ratio` 仍是图片尚未加载或加载失败时的兜底比例；横图选 `landscape`，竖图选 `portrait`。原生大图显示完整图。

照片缺失或 `placeholder: true` 时显示明确占位框；大图预览使用 `assets/placeholder-*.png`。这些只是可识别的排版素材，不是假冒的新人照片。将真实照片的 `placeholder` 改为 `false` 才会加载它。

建议先另存衍生图，不覆盖原始照片：缩略图长边约 600–900 px，展示大图约 1600–2200 px，按画质压缩，尽量使用 JPEG。去除不必要的 EXIF 位置数据，检查人脸授权和清晰度。具体体积以真机体验和开发者工具包体检查为准。

## 3. 写真实故事

修改每个 `storyItems` 的 `date / title / description / photos`，例如将「日期待填写」替换为经过确认的日期或年份。不知道确切日期就写「那年夏天」，不要编造。

相识、旅行、成家、新疆婚礼目前只是示例章节。可以增删、排序；空数组会显示空状态。照片分组的 `title / description` 也直接在 `albums` 配置内修改。

## 4. 每次改完都检查

1. 运行 `npm run check`。
2. 微信开发者工具重新编译，核对日期、姓名、标点与换行。
3. iPhone 和安卓各看一次：滚到底、切换相册、点开大图、确认人像完整。
4. 如果使用云图，测试断网再恢复，检查「重新加载」按钮。
5. 最终确认所有「待填写 / 待替换 / 待确认」都已处理，再准备正式使用。

管理员页的登记时间会按查看者设备的本地时区显示为“提交于 年月日 时:分”，不显示数据库保存的原始 ISO 字符串。

当前内容从本地配置读取，修改配置后需要重新编译/发布才更新。未来若做云端内容编辑，可替换 `services/content.ts`；本版没有宣称实现免发布的云端 CMS。

## 猫咪彩蛋照片与回复时间

首页点击猫咪文案可展开球球、布丁的照片区。修改 content.ts 中的 catPhotos：分别填写 thumbnail / original 的云存储 File ID，设置 placeholder: false。未上传时显示明确占位，不打开假照片；上传后支持点击预览大图。

回复页的最近保存时间与管理员页使用同一日期格式函数，按设备本地时区显示年月日及小时分钟；首次读取、修改保存后均生效。

隐私说明使用面向亲友的通俗文案，集中在 ui-copy.ts 的 privacy 分组；保留信息用途、查看范围、自行删除及转发提醒。保存期限仍是待主人确认的清理建议，不代表已启用自动删除。
