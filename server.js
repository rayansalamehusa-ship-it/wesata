'use strict';
// دار الوساطة — خادم بدون أي اعتماديات خارجية (Node 22.5+)
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = +process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';
const DAY = 864e5, FRESH = (+process.env.FRESH_DAYS || 7) * DAY;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const TYPES = ['شقة', 'فيلا', 'أرض', 'تجاري'], STAGES = ['new', 'contact', 'view', 'neg', 'closed'], STATUSES = ['avail', 'res', 'sold'];

const UP = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UP, { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'app.db'));
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS listings(id INTEGER PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, city TEXT NOT NULL,
  price INTEGER NOT NULL, area INTEGER DEFAULT 0, beds INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'avail', confirmed_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY, src TEXT NOT NULL, listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  name TEXT NOT NULL, phone TEXT NOT NULL, type TEXT, city TEXT, max_price INTEGER DEFAULT 0, stage TEXT NOT NULL DEFAULT 'new',
  note TEXT DEFAULT '', follow_up TEXT DEFAULT '', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_listings_status ON listings(status, confirmed_at);
CREATE TABLE IF NOT EXISTS images(id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE, file TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);
const SET_KEYS = ['office_name', 'phone', 'whatsapp', 'address'];
const getSettings = () => { const o = { office_name: 'دار الوساطة', phone: '', whatsapp: '', address: '' }; for (const r of db.prepare('SELECT k,v FROM settings').all()) o[r.k] = r.v; return o; };
const imgsOf = db.prepare('SELECT id,file FROM images WHERE listing_id=? ORDER BY id');

// ---------- كلمات المرور والجلسات ----------
const hashPw = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const checkPw = (pw, stored) => { const [s, h] = stored.split(':'); const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, s, 64); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const user = process.env.ADMIN_USER || 'admin';
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO users(username,pass) VALUES(?,?)').run(user, hashPw(pw));
  console.log(`\n=== تم إنشاء حساب المكتب ===\nاسم المستخدم: ${user}\nكلمة المرور: ${pw}\nاحفظها الآن وغيّرها لاحقاً (تظهر مرة واحدة فقط)\n`);
}
if (process.env.SEED_DEMO === '1' && !db.prepare('SELECT 1 FROM listings LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO listings(title,type,city,price,area,beds,status,confirmed_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  [['شقة فاخرة بإطلالة', 'شقة', 'الرياض', 1250000, 140, 3, 1], ['فيلا حديثة بحديقة', 'فيلا', 'جدة', 3400000, 420, 5, 2], ['أرض سكنية زاوية', 'أرض', 'الرياض', 890000, 600, 0, 0], ['مكتب تجاري بواجهة رئيسية', 'تجاري', 'جدة', 1750000, 90, 0, 9]]
    .forEach(a => ins.run(a[0], a[1], a[2], a[3], a[4], a[5], 'avail', Date.now() - a[6] * DAY, Date.now()));
}

// ---------- أدوات ----------
const hits = new Map();
function limited(key, max, win) { const n = Date.now(), h = hits.get(key); if (!h || h.r < n) { hits.set(key, { n: 1, r: n + win }); return false; } return ++h.n > max; }
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.r < n) hits.delete(k); db.prepare('DELETE FROM sessions WHERE expires<?').run(n); }, 6e5).unref();
const ipOf = req => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const fail = (res, code, msg) => send(res, code, { error: msg });
function body(req, max = 10240) {
  return new Promise((ok, no) => {
    let d = '', n = 0;
    req.on('data', c => { n += c.length; if (n > max) { no(new Error('big')); req.destroy(); } else d += c; });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { no(new Error('json')); } });
    req.on('error', no);
  });
}
const AR = '٠١٢٣٤٥٦٧٨٩';
const digits = s => String(s).replace(/[٠-٩]/g, d => AR.indexOf(d));
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = v => { const n = parseInt(digits(v), 10); return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : 0; };
const phoneOk = p => /^[0-9+\s-]{7,20}$/.test(digits(p));
const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(a => a[0]).map(a => [a[0], a[1]]));
function authed(req) {
  const t = cookies(req).sid; if (!t) return null;
  return db.prepare('SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(sha(t), Date.now()) || null;
}
const pubL = l => ({ id: l.id, title: l.title, type: l.type, city: l.city, price: l.price, area: l.area, beds: l.beds, ageDays: Math.floor((Date.now() - l.confirmed_at) / DAY), images: imgsOf.all(l.id).map(i => i.file) });
const admL = l => ({ ...pubL(l), images: imgsOf.all(l.id), status: l.status, fresh: l.status === 'avail' && Date.now() - l.confirmed_at < FRESH });

// ---------- المسارات ----------
async function api(req, res, url) {
  const m = req.method, p = url.pathname, ip = ipOf(req);
  if (m !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json')) return fail(res, 415, 'نوع الطلب غير مدعوم');
  let b = {};
  if (m !== 'GET') { try { b = await body(req, /^\/api\/admin\/listings\/\d+\/images$/.test(p) ? 3e6 : 10240); } catch (e) { return fail(res, 400, 'طلب غير صالح'); } }

  // --- عام ---
  if (m === 'GET' && p === '/api/listings') {
    const cut = Date.now() - FRESH;
    const rows = db.prepare("SELECT * FROM listings WHERE status='avail' AND confirmed_at>=? ORDER BY confirmed_at DESC").all(cut);
    const hidden = db.prepare("SELECT COUNT(*) c FROM listings WHERE status='avail' AND confirmed_at<?").get(cut).c;
    return send(res, 200, { listings: rows.map(pubL), hidden, freshDays: FRESH / DAY });
  }
  if (m === 'GET' && p === '/api/settings') return send(res, 200, getSettings());
  if (m === 'POST' && (p === '/api/inquiries' || p === '/api/requests')) {
    if (limited('lead:' + ip, 15, 36e5)) return fail(res, 429, 'محاولات كثيرة، حاول لاحقاً');
    const name = str(b.name, 80), phone = str(b.phone, 20);
    if (name.length < 2 || !phoneOk(phone)) return fail(res, 400, 'تأكد من الاسم ورقم الجوال');
    if (p === '/api/inquiries') {
      const l = db.prepare("SELECT * FROM listings WHERE id=? AND status='avail'").get(num(b.listingId));
      if (!l) return fail(res, 404, 'العقار غير متاح');
      db.prepare("INSERT INTO leads(src,listing_id,name,phone,type,city,created_at) VALUES('inq',?,?,?,?,?,?)").run(l.id, name, digits(phone), l.type, l.city, Date.now());
    } else {
      const type = str(b.type, 20), city = str(b.city, 40);
      if (!TYPES.includes(type) || !city) return fail(res, 400, 'بيانات الطلب غير مكتملة');
      db.prepare("INSERT INTO leads(src,name,phone,type,city,max_price,created_at) VALUES('req',?,?,?,?,?,?)").run(name, digits(phone), type, city, num(b.maxPrice), Date.now());
    }
    return send(res, 201, { ok: true });
  }
  if (m === 'POST' && p === '/api/login') {
    if (limited('login:' + ip, 6, 9e5)) return fail(res, 429, 'محاولات دخول كثيرة، انتظر 15 دقيقة');
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(str(b.username, 60));
    if (!u || typeof b.password !== 'string' || !checkPw(b.password, u.pass)) return fail(res, 401, 'بيانات الدخول غير صحيحة');
    const t = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(sha(t), u.id, Date.now() + 7 * DAY);
    res.setHeader('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${PROD ? '; Secure' : ''}`);
    return send(res, 200, { ok: true });
  }

  // --- إدارة (تتطلب دخولاً) ---
  if (p.startsWith('/api/admin/') || p === '/api/logout') {
    const me = authed(req); if (!me) return fail(res, 401, 'يلزم تسجيل الدخول');
    if (p === '/api/logout') { db.prepare('DELETE FROM sessions WHERE token=?').run(sha(cookies(req).sid)); res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/'); return send(res, 200, { ok: true }); }
    if (m === 'GET' && p === '/api/admin/me') return send(res, 200, { username: me.username });
    if (m === 'PUT' && p === '/api/admin/settings') {
      const v = { office_name: str(b.office_name, 80) || 'دار الوساطة', phone: str(b.phone, 20), whatsapp: digits(str(b.whatsapp, 20)).replace(/\D/g, '').replace(/^00/, ''), address: str(b.address, 160) };
      if (v.phone && !phoneOk(v.phone)) return fail(res, 400, 'رقم الاتصال غير صحيح');
      if (v.whatsapp && !/^\d{8,15}$/.test(v.whatsapp)) return fail(res, 400, 'رقم واتساب يجب أن يكون بالصيغة الدولية بدون + (مثال 966501234567)');
      v.phone = digits(v.phone);
      const up = db.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v');
      for (const k of SET_KEYS) up.run(k, v[k]);
      return send(res, 200, getSettings());
    }
    if (m === 'POST' && p === '/api/admin/password') {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(me.id);
      if (typeof b.current !== 'string' || !checkPw(b.current, u.pass)) return fail(res, 400, 'كلمة المرور الحالية غير صحيحة');
      if (typeof b.next !== 'string' || b.next.length < 8 || b.next.length > 100) return fail(res, 400, 'كلمة المرور الجديدة 8 أحرف على الأقل');
      db.prepare('UPDATE users SET pass=? WHERE id=?').run(hashPw(b.next), me.id);
      db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(me.id, sha(cookies(req).sid));
      return send(res, 200, { ok: true });
    }
    let im = p.match(/^\/api\/admin\/listings\/(\d+)\/images$/);
    if (m === 'POST' && im) {
      const lid = +im[1];
      if (!db.prepare('SELECT 1 FROM listings WHERE id=?').get(lid)) return fail(res, 404, 'العقار غير موجود');
      if (db.prepare('SELECT COUNT(*) c FROM images WHERE listing_id=?').get(lid).c >= 8) return fail(res, 400, 'الحد الأقصى 8 صور لكل عقار');
      const mt = typeof b.data === 'string' && b.data.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
      const buf = mt ? Buffer.from(mt[1], 'base64') : null;
      if (!buf || buf.length < 500 || buf.length > 2.5e6 || buf[0] !== 0xFF || buf[1] !== 0xD8) return fail(res, 400, 'الصورة غير صالحة (JPEG حتى 2.5MB)');
      const file = crypto.randomBytes(12).toString('hex') + '.jpg';
      fs.writeFileSync(path.join(UP, file), buf);
      const r = db.prepare('INSERT INTO images(listing_id,file,created_at) VALUES(?,?,?)').run(lid, file, Date.now());
      return send(res, 201, { id: Number(r.lastInsertRowid), file });
    }
    im = p.match(/^\/api\/admin\/images\/(\d+)$/);
    if (m === 'DELETE' && im) {
      const r = db.prepare('SELECT file FROM images WHERE id=?').get(+im[1]);
      if (r) { db.prepare('DELETE FROM images WHERE id=?').run(+im[1]); fs.rm(path.join(UP, r.file), () => { }); }
      return send(res, 200, { ok: true });
    }
    if (m === 'GET' && p === '/api/admin/listings') return send(res, 200, db.prepare('SELECT * FROM listings ORDER BY confirmed_at ASC').all().map(admL));
    if (m === 'POST' && p === '/api/admin/listings') {
      const title = str(b.title, 120), type = str(b.type, 20), city = str(b.city, 40), price = num(b.price);
      if (title.length < 3 || !TYPES.includes(type) || !city || price < 1) return fail(res, 400, 'أكمل بيانات العقار');
      const r = db.prepare('INSERT INTO listings(title,type,city,price,area,beds,confirmed_at,created_at) VALUES(?,?,?,?,?,?,?,?)').run(title, type, city, price, num(b.area), num(b.beds), Date.now(), Date.now());
      return send(res, 201, { id: Number(r.lastInsertRowid) });
    }
    let mm = p.match(/^\/api\/admin\/listings\/(\d+)\/(confirm|status)$/);
    if (m === 'POST' && mm) {
      const id = +mm[1];
      if (mm[2] === 'confirm') db.prepare("UPDATE listings SET confirmed_at=?, status='avail' WHERE id=?").run(Date.now(), id);
      else { if (!STATUSES.includes(b.status)) return fail(res, 400, 'حالة غير صالحة'); db.prepare('UPDATE listings SET status=? WHERE id=?').run(b.status, id); }
      return send(res, 200, { ok: true });
    }
    if (m === 'DELETE' && (mm = p.match(/^\/api\/admin\/listings\/(\d+)$/))) { const fs_ = imgsOf.all(+mm[1]); db.prepare('DELETE FROM listings WHERE id=?').run(+mm[1]); fs_.forEach(i => fs.rm(path.join(UP, i.file), () => { })); return send(res, 200, { ok: true }); }
    if (m === 'GET' && p === '/api/admin/leads') {
      const cut = Date.now() - FRESH;
      const rows = db.prepare('SELECT l.*, li.title AS listing_title FROM leads l LEFT JOIN listings li ON li.id=l.listing_id ORDER BY l.created_at DESC').all();
      const mq = db.prepare("SELECT id,title,price FROM listings WHERE status='avail' AND confirmed_at>=? AND type=? AND city=? AND (?=0 OR price<=?)");
      return send(res, 200, rows.map(q => ({ id: q.id, src: q.src, name: q.name, phone: q.phone, type: q.type, city: q.city, maxPrice: q.max_price, stage: q.stage, note: q.note, followUp: q.follow_up, listingTitle: q.listing_title,
        matches: q.src === 'req' && q.stage !== 'closed' ? mq.all(cut, q.type, q.city, q.max_price, q.max_price) : [] })));
    }
    if (m === 'PATCH' && (mm = p.match(/^\/api\/admin\/leads\/(\d+)$/))) {
      if (b.stage !== undefined) { if (!STAGES.includes(b.stage)) return fail(res, 400, 'مرحلة غير صالحة'); db.prepare('UPDATE leads SET stage=? WHERE id=?').run(b.stage, +mm[1]); }
      if (b.followUp !== undefined) db.prepare('UPDATE leads SET follow_up=? WHERE id=?').run(/^\d{4}-\d{2}-\d{2}$/.test(b.followUp) ? b.followUp : '', +mm[1]);
      if (b.note !== undefined) db.prepare('UPDATE leads SET note=? WHERE id=?').run(str(b.note, 500), +mm[1]);
      return send(res, 200, { ok: true });
    }
  }
  return fail(res, 404, 'غير موجود');
}

// ---------- الملفات الثابتة ----------
const PUB = path.join(__dirname, 'public'), ADM = path.join(__dirname, 'admin');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function serve(res, root, rel, cache) {
  let f; try { f = path.normalize(path.join(root, decodeURIComponent(rel))); } catch (e) { res.writeHead(400); return res.end(); }
  if (!f.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('الصفحة غير موجودة'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': cache || 'no-cache' });
    res.end(d);
  });
}

http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const p = url.pathname;
    if (p.startsWith('/uploads/')) { const n = p.slice(9); if (!/^[a-f0-9]{24}\.jpg$/.test(n)) { res.writeHead(404); return res.end(); } return serve(res, UP, n, 'public, max-age=31536000, immutable'); }
    if (p === '/admin') { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
    if (p.startsWith('/admin/')) { if (!authed(req)) { res.writeHead(302, { Location: '/login.html' }); return res.end(); } return serve(res, ADM, p === '/admin/' ? 'index.html' : p.slice(7)); }
    serve(res, PUB, p === '/' ? 'index.html' : p.slice(1));
  } catch (e) { console.error(e); if (!res.headersSent) fail(res, 500, 'خطأ في الخادم'); }
}).listen(PORT, () => console.log(`الموقع يعمل على http://localhost:${PORT}`));
