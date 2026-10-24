const ok = (res, data, meta, status = 200) => {
  const body = { data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};
const list = (res, data, { page, pageSize, total }) => ok(res, data, { page, pageSize, total });
/** items + meta from validate.pageOf() */
const paged = (res, { items, meta }) => ok(res, items, meta);
const noContent = (res) => res.status(204).end();
module.exports = { ok, list, paged, noContent };
