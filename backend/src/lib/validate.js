const { z } = require('zod');
const { E } = require('./errors');

// Friendlier messages than zod's defaults, since they are returned to the frontend in details.
z.config({
  customError: (iss) => {
    switch (iss.code) {
      case 'invalid_type':
        return iss.input === undefined ? 'is required' : `must be a ${iss.expected}`;
      case 'too_small':
        return iss.origin === 'string'
          ? (iss.minimum === 1 ? 'must not be empty' : `must be at least ${iss.minimum} characters`)
          : `must be at least ${iss.minimum}`;
      case 'too_big':
        return iss.origin === 'string' ? `must be at most ${iss.maximum} characters` : `must be at most ${iss.maximum}`;
      case 'invalid_value':
        return `must be ${iss.values.length === 2 ? iss.values.join(' or ') : 'one of: ' + iss.values.join(', ')}`;
      case 'invalid_format':
        return iss.format === 'email' ? 'must be a valid email address' : 'has an invalid format';
      default:
        return undefined;
    }
  },
});

/** Parse `data` with a zod schema; throw 422 VALIDATION_ERROR with a {field: message} map. */
function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const details = {};
  for (const issue of r.error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    if (!details[key]) details[key] = issue.message;
  }
  throw E.validation(details);
}

/** Query-string helpers: absent => undefined, '' => undefined. */
const optStr = z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.string().optional());
const optInt = (min, max) =>
  z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : Number(v)),
    z.number({ error: 'must be a number' }).int({ error: 'must be an integer' }).min(min, { error: `must be at least ${min}` }).max(max, { error: `must be at most ${max}` }).optional(),
  );
const optBool = z.preprocess((v) => (v === undefined || v === '' ? undefined : v === true || v === 'true' || v === '1'), z.boolean().optional());
const optDate = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : v),
  z.string().refine((s) => !Number.isNaN(Date.parse(s)), { error: 'must be an ISO date' }).optional(),
);

const pagingShape = { page: optInt(1, 1_000_000), pageSize: optInt(1, 100) };

function paging(q) {
  const p = parse(z.object(pagingShape), q);
  const page = p.page ?? 1;
  const pageSize = p.pageSize ?? 20;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Slice an in-memory list for a `X[]` endpoint: always returns { items, meta } (contract: lists carry meta). */
function pageOf(items, q, defaultSize = 100) {
  const p = parse(z.object(pagingShape), q);
  const page = p.page ?? 1;
  const pageSize = p.pageSize ?? defaultSize;
  return { items: items.slice((page - 1) * pageSize, page * pageSize), meta: { page, pageSize, total: items.length } };
}

module.exports = { pageOf, z, parse, optStr, optInt, optBool, optDate, paging, pagingShape };
