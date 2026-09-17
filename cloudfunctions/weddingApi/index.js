const cloud = require('wx-server-sdk');
const { createHandler } = require('./core');
const { createGuestbookHandler } = require('./guestbook');
const { createPhotoHandler } = require('./photos');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function admins() {
  return (process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
function createIdentityRepository(collectionName) {
  const collection = db.collection(collectionName);
  return {
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
  };
}

const rsvpCollection = db.collection('rsvps');
const rsvpRepository = {
  ...createIdentityRepository('rsvps'),
  async summary() {
    const [all, arriving, guests] = await Promise.all([
      rsvpCollection.count(),
      rsvpCollection.where({ attending: true }).count(),
      rsvpCollection
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
const guestMessageCollection = db.collection('guest_messages');
const guestbookRepository = {
  ...createIdentityRepository('guest_messages'),
  async summary() {
    const result = await guestMessageCollection.count();
    return { messages: result.total };
  },
};

const getOpenId = () => cloud.getWXContext().OPENID;
const handleRsvp = createHandler({
  repository: rsvpRepository,
  getOpenId,
  getAdmins: admins,
});
const handleGuestbook = createGuestbookHandler({
  repository: guestbookRepository,
  getOpenId,
  getAdmins: admins,
});
const handlePhotos = createPhotoHandler({ cloud, db, getAdmins: admins });

exports.main = async (event) =>
  (await handlePhotos(event)) ||
  (await handleGuestbook(event)) ||
  (await handleRsvp(event));
