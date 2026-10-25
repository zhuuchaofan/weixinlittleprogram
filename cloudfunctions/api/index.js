const cloudbase = require('@cloudbase/js-sdk');
const { createRouter } = require('./router');
const {
  invocationFromContext,
  cloudConfigForInvocation,
} = require('./invocation');
const { listAll, readComplete } = require('./paging');
const { createVision } = require('./vision');

function createHouseholdRepository(db) {
  const collection = db.collection('households');
  const _ = db.command;
  return {
    async findByMember(openid) {
      const result = await collection
        .where({ 'members.openid': openid })
        .limit(1)
        .get();
      return result.data[0] || null;
    },
    async findByCode(code) {
      const result = await collection
        .where({ inviteCode: code })
        .limit(1)
        .get();
      return result.data[0] || null;
    },
    async insert(doc) {
      const result = await collection.add(doc);
      return result.id;
    },
    async addMember(id, code, member) {
      // 条件更新保证并发加入时只有一人成功；满员后邀请码清空即失效。
      const result = await collection
        .where({ _id: id, inviteCode: code, memberCount: 1 })
        .update({
          members: _.push([member]),
          memberCount: 2,
          inviteCode: '',
        });
      return result.updated === 1;
    },
    async update(id, fields) {
      await collection.where({ _id: id }).update(fields);
    },
  };
}

/** 业务记录集合：所有读写都限定在 householdId 之内。 */
function createRecordRepository(db, collectionName) {
  const collection = db.collection(collectionName);
  const _ = db.command;
  return {
    listAll: (householdId) => listAll(collection, { householdId }),
    listMonth: (householdId, month) =>
      listAll(collection, {
        householdId,
        date: _.gte(`${month}-01`).and(_.lte(`${month}-31`)),
      }),
    readComplete: (householdId) => readComplete(collection, { householdId }),
    async get(householdId, id) {
      const result = await collection
        .where({ _id: id, householdId })
        .limit(1)
        .get();
      return result.data[0] || null;
    },
    async insert(doc) {
      const result = await collection.add(doc);
      return result.id;
    },
    async insertWithId(id, doc) {
      try {
        await collection.add({ ...doc, _id: id });
        return true;
      } catch (error) {
        // 主键冲突的错误码随 SDK 版本变化，以「该 _id 已存在」为准。
        const existing = await collection.where({ _id: id }).limit(1).get();
        if (existing.data.length > 0) return false;
        throw error;
      }
    },
    async update(householdId, id, fields) {
      await collection.where({ _id: id, householdId }).update(fields);
    },
    async remove(householdId, id) {
      await collection.where({ _id: id, householdId }).remove();
    },
    async removeWhere(householdId, where) {
      const result = await collection.where({ ...where, householdId }).remove();
      return result.deleted || 0;
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
  const db = cloudbase.init(cloudConfigForInvocation(envId)).database();
  const route = createRouter({
    households: createHouseholdRepository(db),
    archive: {
      listRsvps: () => listAll(db.collection('rsvps')),
      listMessages: () => listAll(db.collection('guest_messages')),
    },
    expenses: createRecordRepository(db, 'expenses'),
    todos: createRecordRepository(db, 'todos'),
    dishes: createRecordRepository(db, 'dishes'),
    wishes: createRecordRepository(db, 'wishes'),
    dates: createRecordRepository(db, 'dates'),
    vision: createVision(),
  });
  return route(event, openid);
};
