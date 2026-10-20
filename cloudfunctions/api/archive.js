/** 答谢宴登记与祝福的只读归档。只返回展示字段，不返回 openid。 */
function publicRsvp(record) {
  return {
    guestName: record.guestName,
    attending: record.attending === true,
    partySize: Number.isInteger(record.partySize) ? record.partySize : 0,
    note: typeof record.note === 'string' ? record.note : '',
    updatedAt: record.updatedAt || '',
  };
}

function publicMessage(record) {
  return {
    signature: typeof record.signature === 'string' ? record.signature : '',
    message: typeof record.message === 'string' ? record.message : '',
    updatedAt: record.updatedAt || '',
  };
}

function byTime(a, b) {
  return String(a.updatedAt).localeCompare(String(b.updatedAt));
}

/** repository: listRsvps()、listMessages() 返回全部原始记录。 */
function createArchiveHandler({ repository, requireMembership }) {
  return {
    async 'archive.get'(openid) {
      await requireMembership(openid);
      const [rsvps, messages] = await Promise.all([
        repository.listRsvps(),
        repository.listMessages(),
      ]);
      const records = rsvps.map(publicRsvp).sort(byTime);
      const attending = records.filter((record) => record.attending);
      return {
        rsvps: records,
        messages: messages.map(publicMessage).sort(byTime),
        summary: {
          responses: records.length,
          attending: attending.length,
          declined: records.length - attending.length,
          guests: attending.reduce((sum, record) => sum + record.partySize, 0),
        },
      };
    },
  };
}

module.exports = { createArchiveHandler, publicRsvp, publicMessage };
