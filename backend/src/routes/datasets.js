const express = require('express');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { z, parse, optStr, pageOf } = require('../lib/validate');
const { E } = require('../lib/errors');
const { ok, paged, noContent } = require('../lib/respond');
const ser = require('../lib/serializers');
const { newId } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { ROLE, DATASET_SCOPE: SC, values } = require('../constants');
const { Storage } = require('../services/storage');
const { authenticate } = require('../middleware/auth');

const bodySchema = z.object({
  name: optStr,
  description: z.preprocess((v) => v ?? '', z.string().trim().max(500)),
  scope: z.enum(values(SC)).optional().or(z.literal('').transform(() => undefined)),
  // multipart sends arrays as JSON text or a comma list
  courses: z.preprocess((v) => {
    if (v === undefined || v === '') return [];
    if (Array.isArray(v)) return v;
    try { const j = JSON.parse(v); if (Array.isArray(j)) return j; } catch { /* comma list */ }
    return String(v).split(',').map((s) => s.trim()).filter(Boolean);
  }, z.array(z.string().trim().min(1).max(60)).max(10)),
});

module.exports = (ctx) => {
  const r = express.Router();
  const { db, storage } = ctx;
  const upload = multer({ dest: storage.tmpDir, limits: { fileSize: ctx.cfg.storage.maxDatasetBytes, files: 1 } });
  r.use('/datasets', authenticate(ctx));

  r.get('/datasets', async (req, res) => {
    const q = parse(z.object({ scope: z.enum(values(SC)).optional().or(z.literal('').transform(() => undefined)) }), req.query);
    const qb = db('datasets').orderBy('uploaded_at', 'desc').orderBy('id');
    // "mine" datasets are private to the uploader (nobody else, not even faculty or admin, sees them).
    if (q.scope === SC.SHARED) qb.where({ scope: SC.SHARED });
    else if (q.scope === SC.MINE) qb.where({ scope: SC.MINE, uploaded_by: req.user.id });
    else qb.where((b) => b.where({ scope: SC.SHARED }).orWhere({ scope: SC.MINE, uploaded_by: req.user.id }));
    paged(res, pageOf((await qb).map(ser.dataset), req.query));
  });

  r.post('/datasets', upload.single('file'), async (req, res) => {
    try {
      const b = parse(bodySchema, req.body);
      if (!req.file) throw E.validation({ file: 'is required' });
      const student = req.user.role === ROLE.STUDENT;
      const scope = b.scope || (student ? SC.MINE : SC.SHARED);
      if (student && scope !== SC.MINE) throw E.forbidden('Students can upload only to their own datasets');
      if (!student && scope !== SC.SHARED) throw E.forbidden('Faculty and admins upload shared datasets');
      const name = Storage.sanitizeFileName(b.name || req.file.originalname);
      if (!name) throw E.validation({ name: 'is not a valid file name' });
      const dup = await db('datasets').where({ scope, name }).where((q) => (scope === SC.MINE ? q.where({ uploaded_by: req.user.id }) : q)).first();
      if (dup) throw E.validation({ name: 'a dataset with this name already exists' });
      let dir;
      if (scope === SC.SHARED) dir = storage.datasetsDir;
      else {
        await storage.ensureStudent(req.user.id);
        await storage.assertQuota(req.user.id, req.file.size);
        dir = storage.myDatasetsDir(req.user.id);
      }
      const item = await storage.placeUpload(dir, '/', req.file.path, name);
      const full = path.join(dir, item.name);
      const rows = /\.csv$/i.test(item.name) ? await storage.countCsvRows(full) : null;
      const row = {
        id: newId('dataset'), name: item.name, description: b.description, scope, size_bytes: item.sizeBytes, rows,
        courses: JSON.stringify(b.courses), uploaded_by: req.user.id, uploaded_at: nowIso(),
        rel_path: path.relative(storage.root, full).split(path.sep).join('/'),
      };
      await db('datasets').insert(row);
      storage.invalidateUsage(req.user.id);
      await ctx.audit.log(req.user, 'dataset.upload', `${row.id} ${row.scope}`);
      ok(res, ser.dataset(row), undefined, 201);
    } finally { if (req.file) await fsp.rm(req.file.path, { force: true }).catch(() => {}); }
  });

  r.delete('/datasets/:id', async (req, res) => {
    const ds = await db('datasets').where({ id: req.params.id }).first();
    const visible = ds && (ds.scope === SC.SHARED || ds.uploaded_by === req.user.id || req.user.role === ROLE.ADMIN);
    if (!visible) throw E.notFound('Dataset not found');
    if (ds.uploaded_by !== req.user.id && req.user.role !== ROLE.ADMIN) throw E.forbidden('Only the uploader or an administrator can delete this dataset');
    await fsp.rm(path.join(storage.root, ds.rel_path), { force: true });
    await db('env_datasets').where({ dataset_id: ds.id }).delete();
    await db('datasets').where({ id: ds.id }).delete();
    storage.invalidateUsage(ds.uploaded_by);
    await ctx.audit.log(req.user, 'dataset.delete', ds.id);
    noContent(res);
  });

  return r;
};
