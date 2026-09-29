# 媒体上传

照片、视频分类及私密展示的实现与部署顺序见 [媒体分类与私密说明](MEDIA-CATEGORIES-PRIVACY-PLAN.md)；本地代码已实现，云函数和小程序仍需分别部署及真机验收。

## 使用

照片管理保留原有界面和草稿/发布流程，图片已改为原文件直传。详细架构与部署见 [图片链路](IMAGE-PIPELINE.md)。点击「添加照片」一次最多选择 9 张，以 60 个展示位置减去现有条目和待上传条目计算剩余额度。选择后先预览、删除，再点击「上传并保存待处理媒体」。每项显示状态；失败不会中断其他项，支持单项重试。单张和多张选择均请求原文件，支持 30 MiB 以内 JPG/PNG/WebP；展示端使用可回退的 WebP 缩略图，点击大图读原文件。

「添加视频」每次选择 1 个相册视频，应用上限为 60 秒、30 MB；客户端根据 chooseMedia 返回的视频类别、时长、大小和尺寸校验，不把 iOS 的 getVideoInfo.type 当作 MP4/MOV 文件扩展名。maxDuration 不能代替相册文件时长校验，因此选择后再次检查时长。封面使用微信返回的 thumbTempFilePath，缺失时显示通用播放卡片。视频暂仅支持相册用途；首页封面、故事和猫咪照片用途维持原有图片行为。

文件成功上传后自动保存草稿，不自动发布。点「更新展示」后亲友可在原相册中浏览图片、播放视频。视频按用户点击启动，原生 video 使用 contain 保持比例；另一个视频播放、页面隐藏或组件移除时停止旧视频。错误后点击重试会刷新临时链接。

## 数据兼容

不新增集合、不迁移或删除历史数据，仍保存 photo_content 的 draft / published 文档及 photos 数组。保留 id、original、thumbnail、caption、slot、ratio、placeholder。

新增字段：type（image/video）、url（持久 cloud:// 文件 ID，与 original 相同）；视频附加 coverUrl、duration（秒）、width、height、size（字节）。临时 HTTPS URL 只用于播放，不入库。原 Photo、无 type 数据、imageUrl 对象及 URL 字符串数组在读取边界统一识别为图片；旧数据不被自动改写。

## 上传与异常恢复

- 图片和视频封面通过 prepareImageUpload / verifyImageUpload 授权直传；不编码 Base64、不压缩源文件。旧 uploadPhoto 接口仅保留给旧版客户端。
- 视频由服务端校验 ADMIN_OPENIDS 后签发指定路径的 POST 上传凭据，客户端 wx.uploadFile 上传并显示真实进度；120 秒超时可重试。服务端再下载校验文件大小和 MP4/MOV ftyp 文件头。不会把整段视频装进云函数 Base64 请求。
- 文件成功但数据库失败：保留文件 ID 和媒体信息；重试只保存草稿。恢复队列按环境与模式隔离，存于管理员本机。不会自动删除结果不确定的文件，避免误删已写入草稿的内容。
- 页面隐藏时暂停后续队列并中止正在进行的图片或视频文件传输；已发出的云端校验不能撤回，返回结果仍写入恢复记录。重新进入先等待旧操作结束再读取草稿，避免并发恢复。应用被系统杀死后，重试仍复用 requestId 路径；过期的临时文件需重新选择。
- 云端图片、视频及视频封面都可以复制 File ID，沿用「检查引用 → 确认 → 永久删除」。删除前验证 draft、published 中的 original、thumbnail、url、coverUrl 及历史 imageUrl 引用。仅管理 wedding/managed/ 下 JPG、PNG、WebP、MP4。

## 上线前配置（必须在实际环境执行）

1. 上传并部署 weddingApi，选择云端安装依赖。新增显式依赖 @cloudbase/node-sdk 2.10.0，与现有 wx-server-sdk 3.x 的依赖版本一致；该版本签发 POST 凭据，与 wx.uploadFile 的 multipart POST 匹配。升级 SDK 前需重新核对签名方法，3.18.3 的 getUploadMetadata 改为 PUT，不能直接替换。
2. 继续保留 ADMIN_OPENIDS 服务端白名单；photo_content 客户端规则保持 read:false / write:false。云存储继续允许读取、禁止匿名/普通客户端直接写入，不需要开放全员写权限。
3. 微信公众平台 → 开发管理 → 开发设置 → 服务器域名：把本环境 prepareImageUpload / prepareVideoUpload 返回 url 的 HTTPS 主机加入 uploadFile 合法域名；播放所用实际云存储/CDN 主机按平台要求配置。域名与环境相关，不在源码猜填。先在云函数日志/开发工具中取得主机，勿传播签名或 token。真机测试必须开启合法域名校验。
4. weddingApi 建议配置至少 60 秒超时、256 MB 内存；图片与视频校验会读取最多 30 MiB 文件，产生存储读取流量。核对云环境额度及实际调用超时。
5. 更新公众平台隐私保护指引，准确声明管理员主动选择的照片/视频、公开展示、存储及删除方式；仓库隐私页面与补充说明已经同步。

依赖说明：本地 npm audit 仍报告现有 wx-server-sdk/CloudBase 依赖链的漏洞（包括高危及严重项）。本次锁定依赖以便复现，没有强制跨主版本升级或宣称依赖审计通过；发布前需单独评估和更新 SDK。签发接口只向服务端确认的管理员开放。

## 验收范围

本地自动化覆盖：历史归一化、剩余额度、多选预览/移除、逐项失败、重复点击、数据库保存失败重试、离页恢复、上传进度、视频互斥与隐藏停止、服务端鉴权、稳定上传路径、文件头校验和引用删除保护。

本地 Node/mock 和浏览器预览不能证明微信原生选择器、视频解码、云存储凭据、服务器域名及真实云函数可用。上线前用管理员和访客两个账号，在 iPhone/Android 完成：多图选择→删除一张→上传→保存→重进→发布→大图预览；横/竖视频选择→本地预览→上传→保存→重进→发布→播放→后台/离页停止；断网/超时/部分失败/保存失败→重试；过期播放链接→重试；60 个条目满额、视频超限、取消选择和非管理员调用拒绝。

参考：微信 chooseMedia https://developers.weixin.qq.com/miniprogram/dev/api/media/video/wx.chooseMedia.html；CloudBase 上传元数据 https://docs.cloudbase.net/api-reference/openapi/storage。

## 逐文件改动清单

| 文件                                          | 变更                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| miniprogram/models.ts                         | 扩充可选媒体类型、地址及视频元数据，保留 Photo 原字段                               |
| miniprogram/services/media.ts                 | 统一兼容历史图片与新媒体，集中数量/视频大小时长校验                                 |
| miniprogram/services/media-upload.ts          | 原图直传与视频签名上传、进度、取消、幂等编号和恢复队列                              |
| miniprogram/services/photos.ts                | 草稿和发布数据读取归一化，媒体变化纳入刷新签名                                      |
| miniprogram/services/privacy.ts               | 选择授权提示扩展为照片或视频                                                        |
| miniprogram/utils/preview.ts                  | 图片大图列表排除视频                                                                |
| miniprogram/pages/photos/index.ts             | 多选预览队列、逐项上传重试、保存防重、恢复与生命周期处理                            |
| miniprogram/pages/photos/index.wxml           | 添加照片/视频入口，待处理列表，进度及重试/移除/文件 ID 按钮                         |
| miniprogram/pages/photos/index.wxss           | 沿用页面颜色和间距，增加待处理列表样式                                              |
| miniprogram/pages/gallery/index.wxml          | 原相册混排图片和视频，图片保留 photo-frame                                          |
| miniprogram/components/media-video/index.ts   | 按点击解析链接播放，错误刷新、播放互斥、换源/隐藏/销毁停止                          |
| miniprogram/components/media-video/index.wxml | 封面、播放标识、原生 video 及失败重试                                               |
| miniprogram/components/media-video/index.wxss | 视频比例、封面和播放标识层级                                                        |
| miniprogram/components/media-video/index.json | 声明原生自定义组件                                                                  |
| miniprogram/app.json                          | 注册 media-video 公共组件                                                           |
| miniprogram/config/ui-copy.ts                 | 隐私展示文案覆盖照片和视频                                                          |
| cloudfunctions/weddingApi/index.js            | 注入 CloudBase 上传签名服务                                                         |
| cloudfunctions/weddingApi/photos.js           | 管理员鉴权签名、实际文件校验、视频字段校验保存、稳定图片路径、视频/封面引用删除保护 |
| cloudfunctions/weddingApi/package.json        | 显式声明与现有微信服务端 SDK 同版本的 CloudBase 依赖                                |
| cloudfunctions/weddingApi/package-lock.json   | 锁定云函数依赖以便复现                                                              |
| scripts/preview-server.mjs                    | 将新视频组件加入开发预览                                                            |
| scripts/preview-runtime.js                    | 开发预览支持 VideoContext、视频事件、setData 回调及组件方法绑定                     |
| scripts/test-ui.mjs                           | 增加多图预览移除和图视频混排检查、截图及控制台告警检查                              |
| tests/media.test.cjs                          | 新增兼容、限制、上传队列、失败重试、离页恢复、进度和播放生命周期回归                |
| tests/photos.test.cjs                         | 新增视频管理员鉴权、稳定路径、文件校验和引用删除测试                                |
| tests/rsvp.test.cjs                           | 同步隐私授权提示断言，保留拒绝授权行为验证                                          |
| README.md                                     | 补充媒体功能和部署说明入口                                                          |
| docs/MEDIA-UPLOAD.md                          | 媒体使用、结构、恢复、配置、验收及逐文件改动说明                                    |
| docs/DEPLOYMENT.md                            | 追加媒体部署和上传域名配置入口                                                      |
| docs/PHOTO-MANAGEMENT.md                      | 追加多选/视频文档入口                                                               |
| docs/REVIEW-READINESS.md                      | 补充媒体部署和真机验收入口                                                          |
| docs/PRIVACY-SUPPLEMENT.txt                   | 平台隐私补充说明涵盖照片和视频                                                      |

## 媒体初版验证记录（图片升级结果见 IMAGE-PIPELINE.md）

- npm run check：类型检查、ESLint、43 项单元测试通过。
- npm run check:native：16 个 WXML、17 个 WXSS 编译通过。
- npm run test:ui：73 项浏览器适配预览检查通过（包括媒体队列和图视频混排）；截图位于 artifacts/ui/media-pending.png、media-gallery.png。非微信运行时。
- 未连接实际 CloudBase 环境及 iPhone/Android，未执行真实上传和原生解码验收。
