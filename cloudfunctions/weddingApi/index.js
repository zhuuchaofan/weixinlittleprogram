const cloudbase = require('@cloudbase/js-sdk');
const { createHandler } = require('./core');
const { createGuestbookHandler } = require('./guestbook');
const { createPhotoHandler } = require('./photos');
const { createEventProgramHandler } = require('./event-program');
const { invocationFromContext } = require('./invocation');

const cloudByEnvironment = new Map();

function admins() {
  return (process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
function canCollect() {
  const closesAt = Date.parse(process.env.COLLECTION_CLOSES_AT || '');
  return !Number.isFinite(closesAt) || Date.now() < closesAt;
}
function createIdentityRepository(db, collectionName) {
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

exports.main = async (event, context) => {
  const { openid, envId } = invocationFromContext(
    context,
    cloudbase.parseContext,
    process.env.TCB_ENV || '',
  );
  if (!envId)
    return { ok: false, code: 'UNAVAILABLE', message: '云环境信息缺失' };
  let cloud = cloudByEnvironment.get(envId);
  if (!cloud) {
    cloud = cloudbase.init({ env: envId });
    cloudByEnvironment.set(envId, cloud);
  }
  const db = cloud.database();
  const getOpenId = () => openid;
  const rsvpCollection = db.collection('rsvps');
  const rsvpRepository = {
    ...createIdentityRepository(db, 'rsvps'),
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
    ...createIdentityRepository(db, 'guest_messages'),
    async summary() {
      const result = await guestMessageCollection.count();
      return { messages: result.total };
    },
  };
  const handlePhotos = createPhotoHandler({
    cloud,
    db,
    storage: cloud,
    getAdmins: admins,
    getOpenId,
  });
  const handleEventProgram = createEventProgramHandler({
    db,
    getAdmins: admins,
    getOpenId,
  });
  const handleGuestbook = createGuestbookHandler({
    repository: guestbookRepository,
    getOpenId,
    getAdmins: admins,
    canCollect,
  });
  const handleRsvp = createHandler({
    repository: rsvpRepository,
    getOpenId,
    getAdmins: admins,
    canCollect,
  });
  return (
    (await handlePhotos(event)) ||
    (await handleEventProgram(event)) ||
    (await handleGuestbook(event)) ||
    (await handleRsvp(event))
  );
};
