const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { E } = require('../lib/errors');

const IGNORE_FOR_ACTIVITY = new Set(['node_modules', '.git', 'venv', '.venv', '__pycache__', '.cache', 'target', '.gradle', '.m2']);

/**
 * File storage rooted at STORAGE_ROOT. In production this directory is the Cloud Storage bucket
 * mounted with gcsfuse on both the control VM and the workers, so the API and the lab containers see
 * the same files.
 *
 *   <root>/datasets/                          shared datasets
 *   <root>/students/<userId>/datasets/        a student's own datasets   (mounted at /data/mine)
 *   <root>/students/<userId>/projects/<dir>/  project files              (mounted at /workspace)
 *   <root>/.tmp/                              upload staging
 */
class Storage {
  constructor(cfg) {
    this.cfg = cfg;
    this.root = cfg.storage.root;
    this.workerRoot = cfg.storage.workerRoot;
    this.usageCache = new Map(); // userId -> {at, bytes}
    fs.mkdirSync(path.join(this.root, 'datasets'), { recursive: true });
    fs.mkdirSync(path.join(this.root, 'students'), { recursive: true });
    fs.mkdirSync(this.tmpDir, { recursive: true });
  }

  get tmpDir() { return path.join(this.root, '.tmp'); }
  get datasetsDir() { return path.join(this.root, 'datasets'); }
  studentDir(userId) { return path.join(this.root, 'students', userId); }
  projectsDir(userId) { return path.join(this.studentDir(userId), 'projects'); }
  myDatasetsDir(userId) { return path.join(this.studentDir(userId), 'datasets'); }

  /** Paths as the worker sees them, used as docker bind-mount sources. */
  workerPaths(userId) {
    const r = this.workerRoot;
    return {
      workspace: path.join(r, 'students', userId, 'projects'),
      shared: path.join(r, 'datasets'),
      mine: path.join(r, 'students', userId, 'datasets'),
    };
  }

  async ensureStudent(userId) {
    for (const d of [this.projectsDir(userId), this.myDatasetsDir(userId)]) {
      await fsp.mkdir(d, { recursive: true });
      // The IDE user inside the container (uid 1000) must be able to write here.
      try { await fsp.chmod(d, 0o777); } catch { /* gcsfuse ignores chmod */ }
    }
  }

  // ---- path safety ----------------------------------------------------------------------------
  /** Join a user-supplied relative path under base. Lexical check only; see assertInside for symlinks. */
  safeJoin(base, rel = '/') {
    const s = String(rel ?? '/');
    if (s.includes('\0')) throw E.validation({ path: 'is invalid' });
    const parts = s.split(/[\\/]+/).filter((p) => p && p !== '.');
    if (parts.includes('..')) throw E.validation({ path: 'must not contain ".."' });
    return path.join(base, ...parts);
  }

  /** Resolve symlinks and make sure the real location is still inside base (lab containers can create symlinks). */
  async assertInside(base, target) {
    const realBase = await fsp.realpath(base);
    let probe = target;
    for (;;) {
      try {
        const real = await fsp.realpath(probe);
        if (real === realBase || real.startsWith(realBase + path.sep)) return real;
        throw E.forbidden('Path is outside the project');
      } catch (e) {
        if (e.code === 'ENOENT') {
          const parent = path.dirname(probe);
          if (parent === probe) throw E.notFound('Path not found');
          probe = parent; // not created yet: check the nearest existing ancestor
          continue;
        }
        throw e;
      }
    }
  }

  static sanitizeFileName(name) {
    let n = path.basename(String(name || '').replace(/\\/g, '/')).trim();
    n = n.replace(/[^A-Za-z0-9._ \-()]/g, '_').replace(/^\.+/, '');
    return n.slice(0, 120);
  }

  static slug(name) {
    const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return s || 'project';
  }

  // ---- sizes & activity -----------------------------------------------------------------------
  async dirSize(dir) {
    let total = 0;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      let entries;
      try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) {
          try { total += (await fsp.lstat(p)).size; } catch { /* vanished */ }
        }
      }
    }
    return total;
  }

  /** Bytes used by one student (projects + own datasets). Cached briefly. */
  async usedBytes(userId, { fresh = false } = {}) {
    const hit = this.usageCache.get(userId);
    if (!fresh && hit && Date.now() - hit.at < 10_000) return hit.bytes;
    const bytes = await this.dirSize(this.studentDir(userId));
    this.usageCache.set(userId, { at: Date.now(), bytes });
    return bytes;
  }
  invalidateUsage(userId) { this.usageCache.delete(userId); }

  async assertQuota(userId, addBytes) {
    const used = await this.usedBytes(userId, { fresh: true });
    if (used + addBytes > this.cfg.storage.quotaBytes) {
      const limitGb = (this.cfg.storage.quotaBytes / 1024 ** 3).toFixed(0);
      throw E.quota(`Upload would pass the ${limitGb} GB storage limit`);
    }
  }

  /** Newest modification time (ms) of any file under dir, skipping heavy generated folders. */
  async latestMtime(dir, { maxEntries = 20000, maxDepth = 8 } = {}) {
    let newest = 0;
    let seen = 0;
    const stack = [[dir, 0]];
    while (stack.length && seen < maxEntries) {
      const [d, depth] = stack.pop();
      let entries;
      try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (++seen > maxEntries) break;
        const p = path.join(d, e.name);
        if (e.isSymbolicLink()) continue;
        try {
          const st = await fsp.lstat(p);
          if (st.mtimeMs > newest) newest = st.mtimeMs;
          if (e.isDirectory() && depth < maxDepth && !IGNORE_FOR_ACTIVITY.has(e.name)) stack.push([p, depth + 1]);
        } catch { /* vanished */ }
      }
    }
    return newest;
  }

  async folderSizesGb() {
    const gb = (b) => Math.round((b / 1024 ** 3) * 100) / 100;
    const datasets = await this.dirSize(this.datasetsDir);
    const students = await this.dirSize(path.join(this.root, 'students'));
    return { datasets: gb(datasets), students: gb(students), total: gb(datasets + students) };
  }

  // ---- project files --------------------------------------------------------------------------
  async listDir(base, rel = '/') {
    const dir = this.safeJoin(base, rel);
    await this.assertInside(base, dir);
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw E.notFound('Path not found');
      throw e;
    }
    const baseRel = '/' + path.relative(base, dir).split(path.sep).filter(Boolean).join('/');
    const out = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      if (!e.isDirectory() && !e.isFile()) continue;
      const st = await fsp.lstat(path.join(dir, e.name));
      out.push({
        name: e.name,
        path: (baseRel === '/' ? '' : baseRel) + '/' + e.name,
        type: e.isDirectory() ? 'folder' : 'file',
        sizeBytes: e.isDirectory() ? 0 : st.size,
        modifiedAt: st.mtime.toISOString(),
      });
    }
    out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
    return out;
  }

  /** Move an uploaded temp file to base/rel/<name> and return the FileItem. */
  async placeUpload(base, relDir, tmpPath, originalName) {
    const name = Storage.sanitizeFileName(originalName);
    if (!name) throw E.validation({ file: 'has an invalid file name' });
    const dir = this.safeJoin(base, relDir || '/');
    await fsp.mkdir(dir, { recursive: true });
    await this.assertInside(base, dir);
    const dest = path.join(dir, name);
    await this.assertInside(base, dest);
    // Stream the bytes instead of fs.copyFile: copyFile also calls chmod on the new file, which Azure Blob (blobfuse2) and gcsfuse refuse with EACCES/EPERM.
    await pipeline(fs.createReadStream(tmpPath), fs.createWriteStream(dest));
    await fsp.rm(tmpPath, { force: true });
    try { await fsp.chmod(dest, 0o666); } catch { /* ignore */ }
    const st = await fsp.stat(dest);
    const rel = '/' + path.relative(base, dest).split(path.sep).join('/');
    return { name, path: rel, type: 'file', sizeBytes: st.size, modifiedAt: st.mtime.toISOString() };
  }

  async resolveFile(base, rel) {
    const p = this.safeJoin(base, rel);
    const real = await this.assertInside(base, p);
    let st;
    try { st = await fsp.stat(real); } catch { throw E.notFound('File not found'); }
    if (!st.isFile()) throw E.notFound('File not found');
    return real;
  }

  async removePath(base, rel) {
    if (!rel || rel === '/' || /^[\\/]+$/.test(rel)) throw E.validation({ path: 'must point to a file or folder inside the project' });
    const p = this.safeJoin(base, rel);
    await this.assertInside(base, path.dirname(p));
    try { await fsp.lstat(p); } catch { throw E.notFound('Path not found'); }
    await fsp.rm(p, { recursive: true, force: true });
  }

  // ---- misc ----------------------------------------------------------------------------------
  async countCsvRows(file) {
    let lines = 0;
    let lastByte = 10;
    let any = false;
    await new Promise((resolve, reject) => {
      const s = fs.createReadStream(file);
      s.on('data', (buf) => {
        any = true;
        for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lines++;
        lastByte = buf[buf.length - 1];
      });
      s.on('end', resolve);
      s.on('error', reject);
    });
    if (!any) return 0;
    if (lastByte !== 10) lines++; // last line without trailing newline
    return Math.max(0, lines - 1); // minus header
  }

  tmpName() { return path.join(this.tmpDir, crypto.randomBytes(8).toString('hex')); }
}

module.exports = { Storage };