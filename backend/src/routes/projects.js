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
const { ROLE, LAB_TYPE, values } = require('../constants');
const { Storage } = require('../services/storage');
const { authenticate, requireRole } = require('../middleware/auth');

module.exports = (ctx) => {
  const r = express.Router();
  const { db, storage } = ctx;
  const upload = multer({ dest: storage.tmpDir, limits: { fileSize: ctx.cfg.storage.maxUploadBytes, files: 1 } });
  r.use(['/projects', '/storage'], authenticate(ctx), requireRole(ROLE.STUDENT));

  const own = async (req) => {
    const p = await db('projects').where({ id: req.params.id, user_id: req.user.id }).first();
    if (!p) throw E.notFound('Project not found');
    return { p, base: path.join(storage.projectsDir(req.user.id), p.folder) };
  };
  const modified = async (p, base) => {
    const m = await storage.latestMtime(base, { maxEntries: 2000 });
    return m ? new Date(m).toISOString() : p.modified_at;
  };
  const cleanup = (file) => file && fsp.rm(file.path, { force: true }).catch(() => {});

  r.get('/projects', async (req, res) => {
    const rows = await db('projects').where({ user_id: req.user.id }).orderBy('created_at', 'desc');
    const out = [];
    for (const p of rows) out.push(ser.project(p, await modified(p, path.join(storage.projectsDir(req.user.id), p.folder))));
    paged(res, pageOf(out, req.query));
  });

  r.post('/projects', async (req, res) => {
    const b = parse(z.object({ name: z.string().trim().min(2).max(60), labType: z.enum(values(LAB_TYPE)) }), req.body);
    if (await db('projects').where({ user_id: req.user.id }).whereRaw('lower(name) = ?', [b.name.toLowerCase()]).first()) {
      throw E.validation({ name: 'you already have a project with this name' });
    }
    await storage.ensureStudent(req.user.id);
    const id = newId('project');
    const folder = `${Storage.slug(b.name)}-${id.slice(4)}`;
    const dir = path.join(storage.projectsDir(req.user.id), folder);
    await fsp.mkdir(dir, { recursive: true });
    try { await fsp.chmod(dir, 0o777); } catch { /* gcsfuse */ }
    const now = nowIso();
    const row = { id, user_id: req.user.id, name: b.name, lab_type: b.labType, folder, created_at: now, modified_at: now };
    await db('projects').insert(row);
    ok(res, ser.project(row), undefined, 201);
  });

  r.delete('/projects/:id', async (req, res) => {
    const { p, base } = await own(req);
    await fsp.rm(base, { recursive: true, force: true });
    await db('projects').where({ id: p.id }).delete();
    storage.invalidateUsage(req.user.id);
    noContent(res);
  });

  r.get('/projects/:id/files', async (req, res) => {
    const q = parse(z.object({ path: optStr }), req.query);
    const { base } = await own(req);
    paged(res, pageOf(await storage.listDir(base, q.path || '/'), req.query));
  });

  r.post('/projects/:id/files', upload.single('file'), async (req, res) => {
    try {
      const { p, base } = await own(req);
      if (!req.file) throw E.validation({ file: 'is required' });
      const rel = parse(z.object({ path: optStr }), req.body).path || '/';
      await storage.assertQuota(req.user.id, req.file.size);
      const item = await storage.placeUpload(base, rel, req.file.path, req.file.originalname);
      await db('projects').where({ id: p.id }).update({ modified_at: nowIso() });
      storage.invalidateUsage(req.user.id);
      ok(res, item, undefined, 201);
    } finally { await cleanup(req.file); }
  });

  r.get('/projects/:id/files/download', async (req, res) => {
    const q = parse(z.object({ path: z.string().min(1) }), req.query);
    const { base } = await own(req);
    const file = await storage.resolveFile(base, q.path);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(file, path.basename(file), (err) => { if (err && !res.headersSent) throw E.notFound('File not found'); });
  });

  r.delete('/projects/:id/files', async (req, res) => {
    const q = parse(z.object({ path: z.string().min(1) }), req.query);
    const { p, base } = await own(req);
    await storage.removePath(base, q.path);
    await db('projects').where({ id: p.id }).update({ modified_at: nowIso() });
    storage.invalidateUsage(req.user.id);
    noContent(res);
  });

  r.get('/storage/usage', async (req, res) => {
    ok(res, { usedBytes: await storage.usedBytes(req.user.id, { fresh: true }), limitBytes: ctx.cfg.storage.quotaBytes });
  });

  return r;
};
