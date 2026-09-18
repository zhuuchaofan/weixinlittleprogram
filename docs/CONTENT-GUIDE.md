# 内容维护

## 统一入口

- `miniprogram/config/content.ts`：姓名、日期、地点、照片默认兜底、猫咪文案、隐私联系渠道与收集截止日。
- `miniprogram/config/ui-copy.ts`：页面文案、错误提示和隐私说明。
- `miniprogram/config/music.ts`：背景音乐开关与 File ID，独立于照片、故事内容配置。

只修改字符串或已说明的配置项；不要把管理员 OpenID、密码或临时 HTTPS 链接写进前端。

## 宴会与收集

当前答谢宴为 `2026-09-28 11:58`。`eventDate` 控制首页的宴前、当天和宴后纪念册状态；`collectionCloseDate: '2026-09-29'` 按中国时区从当天零点起停止新增和修改登记、祝福。

地点只维护 `venue`、`address` 和 GCJ-02 `location`。首页只展示店名并可导航；电子请柬展示完整地址。场地变更时一次性更新这三项，并重新真机验证地图。

`privacyContact.account` 是隐私页展示的真实微信号。发布前确认此号可联系到你，且公众平台隐私保护指引使用相同渠道。

## 照片

照片仍只保存 `thumbnail`、`original` 两个 File ID；可先使用同一个原图 File ID。页面展示会把 CloudBase 临时 HTTPS 链接追加 `imageMogr2/thumbnail/1080x1080`，大图预览改用未处理的原图临时链接。无需创建缩略图字段、重复上传婚纱照或保存临时 URL。

- 封面、故事、相册的本地兜底在 `content.ts`。
- 已发布内容由主人工作台的照片管理页控制；云端内容优先。
- 横图填 `landscape`、竖图填 `portrait`、方图填 `square`，原生相框会保留完整照片。
- 仅上传已取得展示授权的素材。管理页“移除展示”不会删除云文件；清理 managed 文件前必须解除草稿与已发布引用。

## 音乐

当前 `musicConfig.enabled` 为 `false`，且 `fileId` 为空，因此页面不显示控制器，也不会创建播放器。

只在有自有或明确获授权公开播放的音频时，将 MP3 上传至 CloudBase（建议 `wedding/music/background.mp3`），把完整 `cloud://` File ID 填入 `music-config` 并启用。建议 MP3、44.1 kHz、128 kbps、2–4 分钟、4 MB 内。音频不会进入代码包。

## 改完检查

1. 运行 `npm run check`。
2. 重新编译，查看首页、请柬、相册、猫咪照片和隐私页。
3. 云图需检查弱网恢复、预览返回和横竖照片比例。
4. 变更收集、隐私或音乐后，按 [自测清单](TEST-CASES.md) 用 iPhone 和安卓各验证一次。
