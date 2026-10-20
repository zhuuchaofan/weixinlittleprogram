const cloudbase = require('@cloudbase/js-sdk');
const { createRouter } = require('./router');
const {
  invocationFromContext,
  cloudConfigForInvocation,
} = require('./invocation');

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

async function listAll(db, collectionName, where = {}) {
  const collection = db.collection(collectionName);
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await collection
      .where(where)
      .orderBy('_id', 'asc')
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .get();
    rows.push(...result.data);
    if (result.data.length < PAGE_SIZE) break;
  }
  return rows;
}

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
    listAll: (householdId) => listAll(db, collectionName, { householdId }),
    listMonth: (householdId, month) =>
      listAll(db, collectionName, {
        householdId,
        date: _.gte(`${month}-01`).and(_.lte(`${month}-31`)),
      }),
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
      listRsvps: () => listAll(db, 'rsvps'),
      listMessages: () => listAll(db, 'guest_messages'),
    },
    expenses: createRecordRepository(db, 'expenses'),
    todos: createRecordRepository(db, 'todos'),
    dishes: createRecordRepository(db, 'dishes'),
    wishes: createRecordRepository(db, 'wishes'),
    dates: createRecordRepository(db, 'dates'),
  });
  return route(event, openid);
};
