/**
 * 退出小家（docs/PLAN.md「退出小家」）：
 * - 只能自己退出，不需要对方同意；两人时退出的人去一个新小家（他是创建者 a），留下的人小家原样不动、邀请码重新生效。
 * - 默认带走完整副本：household.copy 每次复制一批，按原记录 id 算出新 id，中途失败重来不会重复。
 *   副本里付款人、负责人、存入人的角色跟着换（退出的人原来是 b 时 a↔b 互换）；对方的微信身份不带走。
 * - 新小家没有会员；会员天数和订单都留在原来的小家。
 * - 两人同时退出：后到的那个条件更新失败，提示「对方已经退出」。
 * - 只剩一个人时退出：清空这个小家的全部记录，回到创建 / 加入页。
 * - 清空（household.clear）只在小家里只有自己时能用：只清对方记的（按记录人），或全部清空；对方带走的副本在别的小家，动不到。
 * - 注销（account.delete）：删掉自己的全部数据并退出。两人时共同的账本留给对方（里面我记的账目保留，但记录人、修改人抹掉）；
 *   只剩自己时清空整个小家；退出过的小家里留着的我的身份信息也抹掉。会员订单只留交易需要的字段，不动。
 */
const { createHash, randomBytes } = require('node:crypto');
const { ApiError } = require('./errors');

/** 复制的顺序：activity 放最后，它引用前面几类的记录 id。 */
const COPY_ORDER = [
  'expenses',
  'todos',
  'dishes',
  'wishes',
  'dates',
  'goals',
  'insights',
  'activity',
];
const COPY_BATCH = 100;
const INSERT_PARALLEL = 20;
// 一次 remove 删不完时（云数据库单次有上限）接着删，防止死循环的上限。
const MAX_REMOVE_ROUNDS = 50;

const swapRole = (role) => (role === 'a' ? 'b' : role === 'b' ? 'a' : role);

/** 新小家里的记录 id：由新小家和原记录决定，重试时算出来一样，插入就会跳过。 */
function copyId(householdId, oldId) {
  return createHash('sha256')
    .update(`${householdId}:${oldId}`)
    .digest('hex')
    .slice(0, 32);
}

const newHouseholdId = () => randomBytes(16).toString('hex');

/** 把旧小家的一条记录变成新小家的一条：{ id, doc }。 */
function copyRecord(name, record, job, householdId, openid) {
  const swap = (role) => (job.swap ? swapRole(role) : role);
  const { _id: oldId, ...doc } = record;
  doc.householdId = householdId;
  // 对方的微信身份不带走：对方记的、改的，只剩「不是我」。
  if (doc.by !== openid) doc.by = '';
  if (doc.editedBy && doc.editedBy !== openid) doc.editedBy = '';
  if (name === 'expenses' && doc.payer) doc.payer = swap(doc.payer);
  if (name === 'todos' && doc.who) doc.who = swap(doc.who);
  if (name === 'dishes') {
    // 今天的投票不带走；评价按角色存，要跟着换。
    delete doc.votes;
    delete doc.votesOn;
    if (doc.ratings)
      doc.ratings = Object.fromEntries(
        Object.entries(doc.ratings).map(([role, value]) => [swap(role), value]),
      );
  }
  if (name === 'goals' && Array.isArray(doc.log))
    doc.log = doc.log.map((entry) => ({ ...entry, role: swap(entry.role) }));
  if (name === 'insights') return { id: `${householdId}-${doc.month}`, doc };
  if (name === 'activity') {
    doc.refId = copyId(householdId, doc.refId);
    return { id: `${doc.type}_${doc.refId}_${doc.date}`, doc };
  }
  return { id: copyId(householdId, oldId), doc };
}

/**
 * households：findByMember、findById、findDeparted(openid)、insertWithId(id, doc) -> boolean、
 *   leave(id, openid, fields) -> boolean（两人时条件更新）、vacate(id, openid) -> boolean（只剩自己时条件更新）、update。
 * records：各集合的仓储，需要 listAfter(householdId, cursor, limit)、insertWithId、count(householdId, notBy?)、
 *   removeAll(householdId, notBy?)，goals 另需 listAll、update。
 */
function createLeaveHandler({
  households,
  records,
  requireMembership,
  uniqueCode,
  now,
  makeId = newHouseholdId,
}) {
  const names = COPY_ORDER.filter((name) => records[name]);

  /** 按退出时记下的信息建新小家；已经建过就跳过。 */
  async function openNewHome(from, entry) {
    const doc = {
      inviteCode: await uniqueCode(),
      members: [
        {
          openid: entry.openid,
          role: 'a',
          name: entry.name,
          ...(entry.payName ? { payName: entry.payName } : {}),
        },
      ],
      memberCount: 1,
      currency: from.currency,
      splitting: from.splitting === true,
      budgets: from.budgets || {},
      ts: entry.at,
      by: entry.openid,
      copy: entry.copy
        ? {
            from: from._id,
            at: entry.at,
            swap: entry.role === 'b',
            step: 0,
            cursor: '',
            copied: 0,
            done: false,
          }
        : null,
    };
    await households.insertWithId(entry.to, doc);
  }

  /** 退出到一半（旧小家已经退了、新小家没建成）时补建新小家。household.get 读不到小家时调用。 */
  async function resume(openid) {
    if (!households.findDeparted || (await households.findByMember(openid)))
      return;
    const left = await households.findDeparted(openid);
    for (const from of left) {
      const entry = (from.departed || [])
        .filter((item) => item.openid === openid)
        .pop();
      if (entry && !(await households.findById(entry.to))) {
        await openNewHome(from, entry);
        return;
      }
    }
  }

  /** 给 target（退出的人的新小家）复制一批；返回 { done, copied }。 */
  async function copyBatch(target) {
    const job = target.copy;
    if (!job || job.done) return { done: true, copied: job?.copied || 0 };
    const name = names[job.step];
    let { step, cursor, copied } = job;
    if (name) {
      const rows = await records[name].listAfter(job.from, cursor, COPY_BATCH);
      // 退出之后对方新记的不算在副本里。
      const items = rows
        .filter((row) => !(row.ts > job.at))
        .map((row) => copyRecord(name, row, job, target._id, target.by));
      for (let i = 0; i < items.length; i += INSERT_PARALLEL) {
        const inserted = await Promise.all(
          items
            .slice(i, i + INSERT_PARALLEL)
            .map(({ id, doc }) => records[name].insertWithId(id, doc)),
        );
        copied += inserted.filter(Boolean).length;
      }
      if (rows.length < COPY_BATCH) {
        step += 1;
        cursor = '';
      } else cursor = rows[rows.length - 1]._id;
    }
    const done = step >= names.length;
    await households.update(target._id, {
      copy: { ...job, step, cursor, copied, done },
    });
    return { done, copied };
  }

  /**
   * 退出的人还没把副本复制完时，旧小家的记录就是他的副本来源，不能删。
   * 留下的人要清空、或只剩自己要退出时，先替对方复制完：每次调用复制一批，返回 true 表示还没完。
   */
  async function finishPartnerCopy(household) {
    for (const entry of household.departed || []) {
      if (!entry.copy) continue;
      const target = await households.findById(entry.to);
      if (
        target?.copy &&
        !target.copy.done &&
        target.copy.from === household._id
      ) {
        await copyBatch(target);
        return true;
      }
    }
    return false;
  }

  async function removeAll(householdId, notBy) {
    let removed = 0;
    for (const name of names) {
      for (let round = 0; round < MAX_REMOVE_ROUNDS; round++) {
        const deleted = await records[name].removeAll(householdId, notBy);
        removed += deleted;
        if (!deleted) break;
      }
    }
    return removed;
  }

  /** 我的攒钱目标里不是我存的那几笔（角色不是我的）。 */
  async function othersDeposits(household, openid, myRole) {
    if (!records.goals) return [];
    const goals = await records.goals.listAll(household._id);
    return goals
      .filter((goal) => goal.by === openid)
      .map((goal) => ({
        goal,
        others: (goal.log || []).filter((entry) => entry.role !== myRole),
      }))
      .filter((item) => item.others.length);
  }

  /** 把某个小家所有记录里的记录人、修改人是我的抹掉（记录本身留给对方）。 */
  async function anonymize(householdId, openid) {
    for (const name of names) {
      for (let round = 0; round < MAX_REMOVE_ROUNDS; round++) {
        if (!(await records[name].anonymize(householdId, openid))) break;
      }
    }
  }

  /** 我退出过的小家里还留着我的称呼、微信名字和 openid：抹掉，其余（去了哪个新小家、是否复制）不动。 */
  async function scrubDeparted(openid) {
    if (!households.findDeparted) return;
    for (let round = 0; round < 5; round++) {
      const left = await households.findDeparted(openid);
      if (!left.length) return;
      for (const doc of left)
        await households.update(doc._id, {
          departed: doc.departed.map((entry) =>
            entry.openid === openid
              ? { ...entry, openid: '', name: '', payName: '' }
              : entry,
          ),
        });
    }
  }

  /** 只剩自己才能清空、才算「只剩一人」。 */
  function requireAlone(household, message) {
    if (household.members.length !== 1)
      throw new ApiError('VALIDATION', message);
    if (household.copy && !household.copy.done)
      throw new ApiError(
        'BUSY',
        '旧账还没复制完，请先在设置里点「继续复制」，复制完再操作。',
      );
  }

  async function counts(household, openid) {
    const me = household.members.find((member) => member.openid === openid);
    let all = 0;
    let others = 0;
    for (const name of names) {
      all += await records[name].count(household._id);
      others += await records[name].count(household._id, openid);
    }
    const deposits = await othersDeposits(household, openid, me.role);
    for (const item of deposits) others += item.others.length;
    return { all, others };
  }

  return {
    resume,
    actions: {
      /**
       * payload.copy：默认 true，带走完整副本；false 时新小家从空开始。
       * 只剩自己时返回 waiting 表示在替先走的人复制副本、还没退，小程序接着调用。
       */
      async 'household.leave'(openid, payload) {
        const household = await requireMembership(openid);
        const me = household.members.find((member) => member.openid === openid);
        if (household.members.length === 1) {
          requireAlone(household, '');
          if (await finishPartnerCopy(household)) return { waiting: true };
          if (!(await households.vacate(household._id, openid)))
            throw new ApiError('BUSY', '小家刚有变动，请刷新后再试。');
          await removeAll(household._id);
          await households.update(household._id, { purge: false });
          return { left: true, household: null };
        }
        const other = household.members.find(
          (member) => member.openid !== openid,
        );
        const entry = {
          openid,
          role: me.role,
          name: me.name,
          payName: me.payName || '',
          to: makeId(),
          copy: payload?.copy !== false,
          at: now(),
        };
        const left = await households.leave(household._id, openid, {
          members: [other],
          memberCount: 1,
          inviteCode: await uniqueCode(),
          entry,
        });
        if (!left) {
          const fresh = await households.findById(household._id);
          if (fresh && fresh.members.length === 1)
            throw new ApiError(
              'PARTNER_LEFT',
              '对方已经退出了，现在小家里只有你一个人。',
            );
          throw new ApiError('BUSY', '小家刚有变动，请刷新后再试。');
        }
        await openNewHome(household, entry);
        return { left: true, copy: entry.copy };
      },

      /**
       * 注销：payload.confirm 必须是 true。没有小家也能注销（只抹掉退出记录）。
       * 只剩自己时返回 waiting 表示在替先走的人复制副本、还没删，小程序接着调用。
       * 中途失败可以重来：先退出小家、再抹掉记录人，没有小家时重来只做最后的清理。
       */
      async 'account.delete'(openid, payload) {
        if (payload?.confirm !== true)
          throw new ApiError('VALIDATION', '请先确认注销。');
        const household = await households.findByMember(openid);
        if (household && household.members.length === 1) {
          if (await finishPartnerCopy(household)) return { waiting: true };
          if (!(await households.vacate(household._id, openid)))
            throw new ApiError('BUSY', '小家刚有变动，请刷新后再试。');
          await removeAll(household._id);
          await households.update(household._id, { purge: false, by: '' });
        } else if (household) {
          const other = household.members.find(
            (member) => member.openid !== openid,
          );
          const left = await households.withdraw(household._id, openid, {
            members: [other],
            inviteCode: await uniqueCode(),
            by: household.by === openid ? '' : household.by,
          });
          if (!left) throw new ApiError('BUSY', '小家刚有变动，请刷新后再试。');
          await anonymize(household._id, openid);
        }
        await scrubDeparted(openid);
        return { deleted: true };
      },

      /** 复制一批；返回 { done, copied }，没复制完小程序接着调用。 */
      async 'household.copy'(openid) {
        return copyBatch(await requireMembership(openid));
      },

      /** 清空前给确认页看的条数：{ all, others }。 */
      async 'household.clearCount'(openid) {
        const household = await requireMembership(openid);
        requireAlone(household, '对方还在小家里，不能清空。');
        return counts(household, openid);
      },

      /**
       * payload.scope：others 只清对方记的，all 全部清空；返回 { removed }。
       * 返回 waiting 时是在替对方复制副本，什么都还没删，小程序接着调用。
       */
      async 'household.clear'(openid, payload) {
        const scope = payload?.scope;
        if (scope !== 'others' && scope !== 'all')
          throw new ApiError('VALIDATION', '请选择清空哪些记录。');
        const household = await requireMembership(openid);
        requireAlone(household, '对方还在小家里，不能清空。');
        if (await finishPartnerCopy(household))
          return { removed: 0, waiting: true };
        if (scope === 'all') return { removed: await removeAll(household._id) };
        const me = household.members[0];
        let removed = 0;
        for (const { goal, others } of await othersDeposits(
          household,
          openid,
          me.role,
        )) {
          const taken = others.reduce((sum, entry) => sum + entry.amount, 0);
          await records.goals.update(household._id, goal._id, {
            log: goal.log.filter((entry) => entry.role === me.role),
            saved: Math.max(0, (goal.saved || 0) - taken),
          });
          removed += others.length;
        }
        removed += await removeAll(household._id, openid);
        return { removed };
      },
    },
  };
}

module.exports = { createLeaveHandler, copyId, copyRecord, COPY_ORDER };
