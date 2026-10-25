const crypto = require('crypto');

const PREFIX = { user: 'usr', lab: 'lab', env: 'env', project: 'prj', dataset: 'ds', activity: 'act', submission: 'sub' };

function newId(kind) {
  const p = PREFIX[kind];
  if (!p) throw new Error(`Unknown id kind ${kind}`);
  return `${p}_${crypto.randomBytes(5).toString('hex')}`;
}

module.exports = { newId, PREFIX };
