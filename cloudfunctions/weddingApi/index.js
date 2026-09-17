const cloud = require('wx-server-sdk');
const { createHandler } = require('./core');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const collection = db.collection('rsvps');
const repository = {
  async get(id) {
    const result = await collection.where({ _id: id }).limit(1).get();
    return result.data[0] || null;
  },
  async put(id, data) {
    await collection.doc(id).set({ data });
  },
  async remove(id) {
    await collection.where({ _id: id }).remove();
  },
  async list(cursor) {
    const result = await collection
      .where(cursor ? { _id: db.command.gt(cursor) } : {})
      .orderBy('_id', 'asc')
      .limit(50)
      .get();
    return result.data;
  },
  async summary() {
    const [all, arriving, guests] = await Promise.all([
      collection.count(),
      collection.where({ attending: true }).count(),
      collection
        .aggregate()
        .match({ attending: true })
        .group({ _id: null, total: db.command.aggregate.sum('$partySize') })
        .end(),
    ]);
    return {
      responses: all.total,
      attending: arriving.total,
      guests: guests.list[0]?.total || 0,
      declined: all.total - arriving.total,
    };
  },
};
const handleRsvp = createHandler({
  repository,
  getOpenId: () => cloud.getWXContext().OPENID,
  getAdmins: () =>
    (process.env.ADMIN_OPENIDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
});

const { createPhotoHandler } = require('./photos');
const handlePhotos = createPhotoHandler({
  cloud,
  db,
  getAdmins: () =>
    (process.env.ADMIN_OPENIDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
});
exports.main = async (event) =>
  (await handlePhotos(event)) || (await handleRsvp(event));
