/**
 * 想去的照片放在云存储 wish-photos/<householdId>/ 下，小程序上传，fileID 存在想去记录里。
 * 这里是云函数这头读写云存储的两个动作：换临时地址、删文件。
 */
function createStorage(app) {
  return {
    /** fileID 列表 → { fileID: 临时地址 }，换不出来的不返回。 */
    async tempUrls(fileIDs) {
      const result = await app.getTempFileURL({ fileList: fileIDs });
      const urls = {};
      for (const file of result.fileList || [])
        if (file.tempFileURL)
          urls[file.fileID || file.fileId] = file.tempFileURL;
      return urls;
    },
    async remove(fileIDs) {
      if (fileIDs.length) await app.deleteFile({ fileList: fileIDs });
    },
  };
}

module.exports = { createStorage };
