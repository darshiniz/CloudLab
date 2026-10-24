const express = require('express');
const { z, parse, optBool, pageOf } = require('../lib/validate');
const { E } = require('../lib/errors');
const { ok, paged } = require('../lib/respond');
const ser = require('../lib/serializers');
const { newId } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { ROLE, LAB_TYPE, values } = require('../constants');
const { authenticate, requireRole } = require('../middleware/auth');

const IMAGE = /^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]{0,254}$/; // must not start with "-" (it would be read as a docker flag)
const limitsSchema = z.object({
  cpu: z.number().min(0.25).max(4),
  memoryGb: z.number().min(0.25).max(8),
  storageGb: z.number().min(1).max(50),
});
const fields = {
  name: z.string().trim().min(2).max(80),
  type: z.enum(values(LAB_TYPE)),
  description: z.string().trim().min(1).max(500),
  tools: z.array(z.string().trim().min(1).max(40)).max(20),
  dockerImage: z.string().trim().regex(IMAGE, { error: 'must be a valid image name such as cloudlab/python:1.0' }),
  limits: limitsSchema,
  enabled: z.boolean(),
  comingSoon: z.boolean(),
};
const createSchema = z.object({ ...fields, enabled: fields.enabled.default(true), comingSoon: fields.comingSoon.default(false) });
const patchSchema = z.object({ ...fields, limits: limitsSchema.partial() }).partial();

module.exports = (ctx) => {
  const r = express.Router();
  const { db } = ctx;
  r.use('/labs', authenticate(ctx));

  r.get('/labs', async (req, res) => {
    const q = parse(z.object({ includeDisabled: optBool }), req.query);
    const all = q.includeDisabled && req.user.role === ROLE.ADMIN;
    const qb = db('labs').orderBy('created_at').orderBy('name');
    if (!all) qb.where('enabled', 1); // "coming soon" templates are enabled=true, comingSoon=true
    paged(res, pageOf((await qb).map(ser.lab), req.query));
  });

  r.get('/labs/:id', async (req, res) => {
    const row = await db('labs').where({ id: req.params.id }).first();
    if (!row || (req.user.role !== ROLE.ADMIN && !row.enabled)) throw E.notFound('Lab template not found');
    ok(res, ser.lab(row));
  });

  r.post('/labs', requireRole(ROLE.ADMIN), async (req, res) => {
    const b = parse(createSchema, req.body);
    const row = {
      id: newId('lab'), name: b.name, type: b.type, description: b.description, tools: JSON.stringify(b.tools),
      docker_image: b.dockerImage, cpu: b.limits.cpu, memory_gb: b.limits.memoryGb, storage_gb: b.limits.storageGb,
      enabled: b.enabled ? 1 : 0, coming_soon: b.comingSoon ? 1 : 0, created_at: nowIso(),
    };
    await db('labs').insert(row);
    await ctx.audit.log(req.user, 'lab.create', `${row.id} ${row.name}`);
    ok(res, ser.lab(row), undefined, 201);
  });

  r.patch('/labs/:id', requireRole(ROLE.ADMIN), async (req, res) => {
    const cur = await db('labs').where({ id: req.params.id }).first();
    if (!cur) throw E.notFound('Lab template not found');
    const b = parse(patchSchema, req.body);
    const upd = {};
    if (b.name !== undefined) upd.name = b.name;
    if (b.type !== undefined) upd.type = b.type;
    if (b.description !== undefined) upd.description = b.description;
    if (b.tools !== undefined) upd.tools = JSON.stringify(b.tools);
    if (b.dockerImage !== undefined) upd.docker_image = b.dockerImage;
    if (b.limits?.cpu !== undefined) upd.cpu = b.limits.cpu;
    if (b.limits?.memoryGb !== undefined) upd.memory_gb = b.limits.memoryGb;
    if (b.limits?.storageGb !== undefined) upd.storage_gb = b.limits.storageGb;
    if (b.enabled !== undefined) upd.enabled = b.enabled ? 1 : 0;
    if (b.comingSoon !== undefined) upd.coming_soon = b.comingSoon ? 1 : 0;
    if (Object.keys(upd).length) {
      await db('labs').where({ id: cur.id }).update(upd);
      await ctx.audit.log(req.user, 'lab.update', `${cur.id} ${Object.keys(upd).join(',')}`);
    }
    // Existing labs keep the image and limits they were created with; changes apply to new labs only.
    ok(res, ser.lab(await db('labs').where({ id: cur.id }).first()));
  });

  return r;
};
