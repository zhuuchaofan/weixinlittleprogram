class EventProgramInputError extends Error {}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ITEMS = 20;

function text(value, label, max, required = false) {
  if (typeof value !== 'string')
    throw new EventProgramInputError(`${label}格式无效`);
  const clean = value.trim();
  if (required && !clean) throw new EventProgramInputError(`${label}不能为空`);
  if (clean.length > max)
    throw new EventProgramInputError(`${label}不能超过${max}字`);
  return clean;
}
function time(value, label) {
  const clean = text(value, label, 5);
  if (clean && !TIME_PATTERN.test(clean))
    throw new EventProgramInputError(`${label}请填写 HH:mm`);
  return clean;
}
function validateEventProgram(value) {
  if (!value || typeof value !== 'object')
    throw new EventProgramInputError('流程内容无效');
  if (!Array.isArray(value.items) || value.items.length > MAX_ITEMS)
    throw new EventProgramInputError(`流程最多保留${MAX_ITEMS}项`);
  const ids = new Set();
  const items = value.items.map((item, index) => {
    if (!item || typeof item !== 'object')
      throw new EventProgramInputError(`第${index + 1}项流程无效`);
    const id = text(item.id, `第${index + 1}项编号`, 80, true);
    if (ids.has(id)) throw new EventProgramInputError('流程编号不能重复');
    ids.add(id);
    if (typeof item.visible !== 'boolean')
      throw new EventProgramInputError(`第${index + 1}项显示状态无效`);
    return {
      id,
      title: text(item.title, `第${index + 1}项名称`, 40, true),
      time: time(item.time, `第${index + 1}项时间`),
      description: text(item.description, `第${index + 1}项提示`, 80),
      visible: item.visible,
    };
  });
  const booth = value.photoBooth;
  if (!booth || typeof booth !== 'object' || typeof booth.enabled !== 'boolean')
    throw new EventProgramInputError('Photo Booth 信息无效');
  return {
    title: text(value.title, '流程标题', 40, true),
    lead: text(value.lead, '流程说明', 120),
    items,
    photoBooth: {
      enabled: booth.enabled,
      title: text(booth.title, 'Photo Booth 标题', 40, true),
      time: time(booth.time, 'Photo Booth 时间'),
      description: text(booth.description, 'Photo Booth 说明', 120),
    },
  };
}
function createEventProgramHandler({ db, getAdmins }) {
  const collection = db.collection('event_program');
  const allowed = new Set([
    'getEventProgram',
    'getEventProgramDraft',
    'saveEventProgramDraft',
    'publishEventProgram',
  ]);
  return async function handleEventProgram(event) {
    const action = event?.action;
    if (!allowed.has(action)) return null;
    const openid = event?.userInfo?.openid;
    try {
      if (action === 'getEventProgram') {
        const result = await collection
          .doc('published')
          .get()
          .catch(() => null);
        return { ok: true, data: result?.data?.program || null };
      }
      if (!getAdmins().includes(openid))
        return {
          ok: false,
          code: 'FORBIDDEN',
          message: '仅主人可以管理当天流程',
        };
      if (action === 'getEventProgramDraft') {
        const result = await collection
          .doc('draft')
          .get()
          .catch(() => null);
        return { ok: true, data: result?.data?.program || null };
      }
      const program = validateEventProgram(event?.payload?.program);
      await collection
        .doc('draft')
        .set({ data: { program, updatedAt: new Date().toISOString() } });
      if (action === 'publishEventProgram')
        await collection
          .doc('published')
          .set({ data: { program, updatedAt: new Date().toISOString() } });
      return { ok: true, data: null };
    } catch (error) {
      return {
        ok: false,
        code: 'EVENT_PROGRAM_ERROR',
        message:
          error instanceof EventProgramInputError
            ? error.message
            : '流程操作失败，请检查云函数和 event_program 集合配置后重试',
      };
    }
  };
}
module.exports = { createEventProgramHandler, validateEventProgram };
