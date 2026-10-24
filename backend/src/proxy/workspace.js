const httpProxy = require('http-proxy');
const { USER_STATUS } = require('../constants');

const COOKIE = 'cl_ws';
const PATH_RE = /^\/lab\/(env_[a-f0-9]{10})(\/[^?]*)?(\?.*)?$/;

function cookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * Reverse proxy that puts each lab's IDE behind the API: /lab/<envId>/... -> http://<worker-ip>:<port>/...
 * Lab ports are bound to the worker's internal IP only, so this is the only way in. Access needs the
 * short-lived workspace token from GET /environments/:id/access, which is exchanged for an HttpOnly cookie.
 */
function createWorkspaceProxy(ctx) {
  const proxy = httpProxy.createProxyServer({ xfwd: true, ws: true, changeOrigin: false });
  const secure = ctx.cfg.publicBaseUrl.startsWith('https://');

  proxy.on('error', (err, req, res) => {
    ctx.log.warn({ err: err.message }, 'workspace proxy error');
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The lab is not reachable right now. Go back to CloudLab and check its status.');
    } else if (res && typeof res.destroy === 'function') res.destroy();
  });

  /** Returns { envId, rest, query, token, fromQuery } or null. */
  function parse(req) {
    const m = PATH_RE.exec(req.originalUrl || req.url);
    if (!m) return null;
    const query = new URLSearchParams((m[3] || '').slice(1));
    const wt = query.get('wt');
    const token = wt || cookies(req.headers.cookie)[`${COOKIE}`];
    return { envId: m[1], rest: m[2] || '/', query, token, fromQuery: !!wt };
  }

  async function authorize(info) {
    const claims = info.token ? ctx.auth.verifyWorkspaceToken(info.token) : null;
    if (!claims || claims.env !== info.envId) return { status: 401, text: 'Open the workspace again from CloudLab.' };
    const user = await ctx.users.byId(claims.sub);
    if (!user || user.status !== USER_STATUS.ACTIVE) return { status: 403, text: 'This account cannot open labs.' };
    const target = await ctx.envs.workspaceTarget(info.envId);
    if (!target || target.env.user_id !== claims.sub) return { status: 404, text: 'This lab is not running.' };
    return { target, claims };
  }

  const forwardPath = (info) => {
    info.query.delete('wt');
    const qs = info.query.toString();
    return info.rest + (qs ? `?${qs}` : '');
  };
  const stripCookie = (req) => {
    const rest = (req.headers.cookie || '').split(';').filter((c) => !c.trim().startsWith(`${COOKIE}=`)).join(';').trim();
    if (rest) req.headers.cookie = rest; else delete req.headers.cookie;
  };

  async function http(req, res, next) {
    const info = parse(req);
    if (!info) return next();
    const a = await authorize(info);
    if (!a.target) return res.status(a.status).type('text/plain').send(a.text);
    if (info.fromQuery) {
      // Swap the URL token for a cookie so the token does not stay in the address bar or logs.
      const maxAge = Math.max(60, Math.floor((a.claims.exp * 1000 - Date.now()) / 1000));
      res.setHeader('Set-Cookie', `${COOKIE}=${info.token}; Path=/lab/${info.envId}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, `/lab/${info.envId}${forwardPath(info)}`);
    }
    stripCookie(req);
    req.url = forwardPath(info);
    proxy.web(req, res, { target: `http://${a.target.host}:${a.target.port}` });
  }

  /** WebSocket upgrade (the IDE and its terminal use WebSockets). */
  async function upgrade(req, socket, head) {
    const reject = (code, text) => { try { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`); } catch { socket.destroy(); } };
    try {
      const info = parse(req);
      if (!info) return reject(404, 'Not Found');
      const origin = req.headers.origin;
      if (origin) {
        const allowed = new Set([new URL(ctx.cfg.publicBaseUrl).host, req.headers.host]);
        let ok = false;
        try { ok = allowed.has(new URL(origin).host); } catch { /* bad origin */ }
        if (!ok) return reject(403, 'Forbidden');
      }
      const a = await authorize(info);
      if (!a.target) return reject(a.status, 'Unauthorized');
      stripCookie(req);
      req.url = forwardPath(info);
      proxy.ws(req, socket, head, { target: `ws://${a.target.host}:${a.target.port}` });
    } catch (e) {
      ctx.log.warn({ err: e.message }, 'workspace upgrade failed');
      reject(500, 'Error');
    }
  }

  return { http, upgrade, isLabPath: (url) => (url || '').startsWith('/lab/'), close: () => proxy.close() };
}

module.exports = { createWorkspaceProxy };
