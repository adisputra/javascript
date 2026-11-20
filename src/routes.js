// REST API — dipakai oleh website dan bisa dipakai aplikasi mobile (token Bearer).
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { all, get, run, tx } = require('./db');
const auth = require('./auth');
const svc = require('./services');
const chatbot = require('./chatbot');

const router = express.Router();
const admin = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) {
    next(e);
  }
};

const str = (v, max = 255) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const int = (v, def = 0) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : def;
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* =========================================================
 *  PUBLIK
 * ========================================================= */
router.get('/info', (_req, res) => {
  const s = svc.getSettings();
  const stats = get(
    "SELECT ROUND(AVG(rating),1) AS avg, COUNT(*) AS n FROM reviews WHERE approved = 1"
  );
  res.json({ ...s, rating_avg: stats.avg || 0, rating_count: stats.n });
});

router.get('/categories', (_req, res) => {
  res.json(all('SELECT category, COUNT(*) AS count FROM equipment WHERE active = 1 GROUP BY category ORDER BY category'));
});

/** GET /api/equipment?start=YYYY-MM-DD&end=YYYY-MM-DD&category=&q= */
router.get('/equipment', (req, res) => {
  const { start, end, category, q } = req.query;
  if ((start && !svc.isValidDate(start)) || (end && !svc.isValidDate(end)))
    return res.status(400).json({ error: 'Format tanggal harus YYYY-MM-DD.' });
  let sql = 'SELECT * FROM equipment WHERE active = 1';
  const p = [];
  if (category) {
    sql += ' AND category = ?';
    p.push(String(category));
  }
  if (q) {
    sql += ' AND (name LIKE ? OR description LIKE ?)';
    p.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY category, name';
  res.json(all(sql, ...p).map((e) => svc.equipmentWithAvailability(e, start, end)));
});

router.get('/equipment/:id', (req, res) => {
  const e = get('SELECT * FROM equipment WHERE id = ? AND active = 1', req.params.id);
  if (!e) return res.status(404).json({ error: 'Barang tidak ditemukan.' });
  res.json(svc.equipmentWithAvailability(e, req.query.start, req.query.end));
});

router.get('/reviews', (_req, res) => {
  res.json(
    all('SELECT id, name, rating, comment, created_at FROM reviews WHERE approved = 1 ORDER BY created_at DESC LIMIT 30')
  );
});

router.post('/contact', (req, res) => {
  const name = str(req.body.name, 100);
  const contact = str(req.body.contact, 150);
  const message = str(req.body.message, 2000);
  if (!name || !contact || !message) return res.status(400).json({ error: 'Nama, kontak, dan pesan wajib diisi.' });
  run('INSERT INTO messages (name, contact, message) VALUES (?, ?, ?)', name, contact, message);
  res.status(201).json({ ok: true, message: 'Pesan terkirim. Kami akan segera menghubungi Anda.' });
});

router.post(
  '/chat',
  wrap(async (req, res) => {
    const message = str(req.body.message, 2000);
    if (!message) return res.status(400).json({ error: 'Pesan kosong.' });
    res.json(await chatbot.reply(message, req.body.history));
  })
);

/* =========================================================
 *  AKUN PELANGGAN
 * ========================================================= */
router.post('/auth/register', (req, res) => {
  const name = str(req.body.name, 100);
  const email = str(req.body.email, 150)?.toLowerCase();
  const phone = str(req.body.phone, 30);
  const password = String(req.body.password || '');
  if (!name || !email || !phone) return res.status(400).json({ error: 'Nama, email, dan no. HP wajib diisi.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Format email tidak valid.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
  if (get('SELECT id FROM users WHERE email = ?', email))
    return res.status(409).json({ error: 'Email sudah terdaftar. Silakan login.' });
  const r = run(
    'INSERT INTO users (name, email, phone, address, id_number, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
    name,
    email,
    phone,
    str(req.body.address, 300),
    str(req.body.id_number, 30),
    auth.hashPassword(password)
  );
  const user = auth.publicUser(get('SELECT * FROM users WHERE id = ?', r.lastInsertRowid));
  res.status(201).json({ token: auth.createSession(user.id), user });
});

router.post('/auth/login', (req, res) => {
  const email = str(req.body.email, 150)?.toLowerCase();
  const u = email && get('SELECT * FROM users WHERE email = ?', email);
  if (!u || !auth.verifyPassword(String(req.body.password || ''), u.password_hash))
    return res.status(401).json({ error: 'Email atau password salah.' });
  res.json({ token: auth.createSession(u.id), user: auth.publicUser(u) });
});

router.post('/auth/logout', auth.requireAuth, (req, res) => {
  auth.destroySession(req.token);
  res.json({ ok: true });
});

router.get('/me', auth.requireAuth, (req, res) => res.json(req.user));

router.put('/me', auth.requireAuth, (req, res) => {
  const b = req.body;
  const name = str(b.name, 100) || req.user.name;
  const phone = str(b.phone, 30) || req.user.phone;
  run(
    'UPDATE users SET name = ?, phone = ?, address = ?, id_number = ? WHERE id = ?',
    name,
    phone,
    b.address !== undefined ? str(b.address, 300) : req.user.address,
    b.id_number !== undefined ? str(b.id_number, 30) : req.user.id_number,
    req.user.id
  );
  if (b.new_password) {
    const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!auth.verifyPassword(String(b.current_password || ''), u.password_hash))
      return res.status(400).json({ error: 'Password lama salah.' });
    if (String(b.new_password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(String(b.new_password)), req.user.id);
  }
  res.json(auth.publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)));
});

/** Hitung estimasi biaya tanpa menyimpan. */
router.post('/quote', (req, res) => {
  const { start_date, end_date, items } = req.body;
  if (!svc.isValidDate(start_date) || !svc.isValidDate(end_date) || end_date <= start_date)
    return res.status(400).json({ error: 'Tanggal tidak valid.' });
  const days = svc.rentalDays(start_date, end_date);
  const lines = (Array.isArray(items) ? items : []).map((it) => {
    const e = get('SELECT * FROM equipment WHERE id = ? AND active = 1', it.equipment_id);
    if (!e) return { equipment_id: it.equipment_id, error: 'tidak ditemukan' };
    const qty = Math.max(1, int(it.qty, 1));
    const available = svc.availableQty(e.id, start_date, end_date);
    return { equipment_id: e.id, name: e.name, qty, available, ok: qty <= available, line_total: e.price_per_day * qty * days };
  });
  res.json({ days, lines, total: lines.reduce((s, l) => s + (l.line_total || 0), 0) });
});

router.post('/bookings', auth.requireAuth, (req, res) => {
  const b = svc.createBooking({ userId: req.user.id, ...req.body });
  res.status(201).json(b);
});

router.get('/bookings', auth.requireAuth, (req, res) => {
  const ids = all('SELECT id FROM bookings WHERE user_id = ? ORDER BY created_at DESC', req.user.id);
  res.json(ids.map((r) => svc.getBooking(r.id)));
});

router.get('/bookings/:id', auth.requireAuth, (req, res) => {
  const b = svc.getBooking(int(req.params.id));
  if (!b || (b.user_id !== req.user.id && req.user.role !== 'admin'))
    return res.status(404).json({ error: 'Booking tidak ditemukan.' });
  res.json(b);
});

router.post('/bookings/:id/cancel', auth.requireAuth, (req, res) => {
  const b = get('SELECT * FROM bookings WHERE id = ? AND user_id = ?', int(req.params.id), req.user.id);
  if (!b) return res.status(404).json({ error: 'Booking tidak ditemukan.' });
  if (!['menunggu', 'dikonfirmasi'].includes(b.status))
    return res.status(400).json({ error: 'Booking ini tidak bisa dibatalkan lagi.' });
  res.json(svc.changeBookingStatus(b.id, 'dibatalkan'));
});

router.post('/reviews', auth.requireAuth, (req, res) => {
  const rating = int(req.body.rating);
  const comment = str(req.body.comment, 1000);
  if (rating < 1 || rating > 5 || !comment) return res.status(400).json({ error: 'Rating 1–5 dan komentar wajib diisi.' });
  run('INSERT INTO reviews (user_id, name, rating, comment) VALUES (?, ?, ?, ?)', req.user.id, req.user.name, rating, comment);
  res.status(201).json({ ok: true, message: 'Terima kasih! Ulasan akan tampil setelah disetujui admin.' });
});

/* =========================================================
 *  ADMIN
 * ========================================================= */
admin.use(auth.requireAdmin);

/* ---- Dashboard ---- */
admin.get('/dashboard', (_req, res) => {
  const t = svc.today();
  const month = t.slice(0, 7);
  const sum = (sql, ...p) => get(sql, ...p).v || 0;
  const outstanding = svc.outstandingBookings();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(t + 'T00:00:00Z');
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    const m = d.toISOString().slice(0, 7);
    months.push({ month: m, total: sum("SELECT SUM(amount) AS v FROM payments WHERE substr(paid_at,1,7) = ?", m) });
  }
  res.json({
    today: t,
    income_today: sum('SELECT SUM(amount) AS v FROM payments WHERE substr(paid_at,1,10) = ?', t),
    income_month: sum('SELECT SUM(amount) AS v FROM payments WHERE substr(paid_at,1,7) = ?', month),
    income_total: sum('SELECT SUM(amount) AS v FROM payments'),
    outstanding_total: outstanding.reduce((s, b) => s + b.balance, 0),
    outstanding_count: outstanding.length,
    bookings_pending: sum("SELECT COUNT(*) AS v FROM bookings WHERE status = 'menunggu'"),
    bookings_active: sum("SELECT COUNT(*) AS v FROM bookings WHERE status = 'diambil'"),
    late_returns: sum("SELECT COUNT(*) AS v FROM bookings WHERE status = 'diambil' AND end_date < ?", t),
    pickups_today: all(
      `SELECT b.id, b.code, u.name AS customer_name FROM bookings b JOIN users u ON u.id = b.user_id
        WHERE b.start_date = ? AND b.status IN ('menunggu','dikonfirmasi')`,
      t
    ),
    returns_today: all(
      `SELECT b.id, b.code, u.name AS customer_name FROM bookings b JOIN users u ON u.id = b.user_id
        WHERE b.end_date = ? AND b.status = 'diambil'`,
      t
    ),
    customers: sum("SELECT COUNT(*) AS v FROM users WHERE role = 'customer'"),
    equipment_types: sum('SELECT COUNT(*) AS v FROM equipment WHERE active = 1'),
    units_total: sum('SELECT SUM(stock_total) AS v FROM equipment WHERE active = 1'),
    units_out: sum(
      "SELECT SUM(bi.qty) AS v FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id WHERE b.status = 'diambil'"
    ),
    units_maintenance: sum("SELECT SUM(qty) AS v FROM maintenance WHERE status = 'proses'"),
    unread_messages: sum('SELECT COUNT(*) AS v FROM messages WHERE handled = 0'),
    pending_reviews: sum('SELECT COUNT(*) AS v FROM reviews WHERE approved = 0'),
    income_by_month: months,
  });
});

/* ---- Database peralatan ---- */
admin.get('/equipment', (_req, res) => {
  res.json(all('SELECT * FROM equipment ORDER BY active DESC, category, name').map((e) => svc.equipmentWithAvailability(e)));
});

function equipmentFields(body, file, existing = {}) {
  return {
    name: str(body.name, 120) ?? existing.name,
    category: str(body.category, 60) ?? existing.category ?? 'Lainnya',
    description: body.description !== undefined ? str(body.description, 2000) : existing.description,
    price_per_day: body.price_per_day !== undefined ? Math.max(0, int(body.price_per_day)) : existing.price_per_day,
    sku: body.sku !== undefined ? str(body.sku, 60) : existing.sku,
    image_url: file ? `/uploads/${file.filename}` : body.image_url !== undefined ? str(body.image_url, 500) : existing.image_url,
    active: body.active !== undefined ? (String(body.active) === '0' || body.active === false ? 0 : 1) : existing.active ?? 1,
  };
}

admin.post('/equipment', upload.single('image'), (req, res) => {
  const f = equipmentFields(req.body, req.file);
  const stock = Math.max(0, int(req.body.stock_total));
  if (!f.name || f.price_per_day === undefined) return res.status(400).json({ error: 'Nama dan harga wajib diisi.' });
  const id = tx(() => {
    const r = run(
      'INSERT INTO equipment (name, category, description, price_per_day, stock_total, image_url, sku, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      f.name, f.category, f.description, f.price_per_day, stock, f.image_url, f.sku, f.active
    );
    const id = Number(r.lastInsertRowid);
    if (stock > 0)
      run(
        "INSERT INTO stock_movements (equipment_id, direction, kind, qty, reason) VALUES (?, 'masuk', 'inventaris', ?, 'Stok awal')",
        id,
        stock
      );
    return id;
  });
  res.status(201).json(svc.equipmentWithAvailability(get('SELECT * FROM equipment WHERE id = ?', id)));
});

admin.put('/equipment/:id', upload.single('image'), (req, res) => {
  const e = get('SELECT * FROM equipment WHERE id = ?', req.params.id);
  if (!e) return res.status(404).json({ error: 'Barang tidak ditemukan.' });
  const f = equipmentFields(req.body, req.file, e);
  run(
    'UPDATE equipment SET name=?, category=?, description=?, price_per_day=?, image_url=?, sku=?, active=? WHERE id=?',
    f.name, f.category, f.description, f.price_per_day, f.image_url, f.sku, f.active, e.id
  );
  res.json(svc.equipmentWithAvailability(get('SELECT * FROM equipment WHERE id = ?', e.id)));
});

admin.delete('/equipment/:id', (req, res) => {
  const e = get('SELECT * FROM equipment WHERE id = ?', req.params.id);
  if (!e) return res.status(404).json({ error: 'Barang tidak ditemukan.' });
  const used = get('SELECT COUNT(*) AS n FROM booking_items WHERE equipment_id = ?', e.id).n;
  if (used > 0) {
    run('UPDATE equipment SET active = 0 WHERE id = ?', e.id);
    return res.json({ ok: true, archived: true, message: 'Barang punya riwayat sewa, jadi dinonaktifkan (diarsipkan).' });
  }
  run('DELETE FROM equipment WHERE id = ?', e.id);
  res.json({ ok: true });
});

/* ---- Keluar / masuk barang ---- */
admin.get('/stock-movements', (req, res) => {
  const p = [];
  let where = '1=1';
  if (req.query.equipment_id) {
    where += ' AND m.equipment_id = ?';
    p.push(int(req.query.equipment_id));
  }
  if (req.query.from) {
    where += ' AND substr(m.created_at,1,10) >= ?';
    p.push(String(req.query.from));
  }
  if (req.query.to) {
    where += ' AND substr(m.created_at,1,10) <= ?';
    p.push(String(req.query.to));
  }
  res.json(
    all(
      `SELECT m.*, e.name AS equipment_name, b.code AS booking_code FROM stock_movements m
         JOIN equipment e ON e.id = m.equipment_id LEFT JOIN bookings b ON b.id = m.booking_id
        WHERE ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT 500`,
      ...p
    )
  );
});

/** Catat pembelian (masuk) atau barang rusak/hilang/dijual (keluar) — mengubah stok total. */
admin.post('/stock-movements', (req, res) => {
  const equipment_id = int(req.body.equipment_id);
  const qty = int(req.body.qty);
  const direction = req.body.direction === 'keluar' ? 'keluar' : 'masuk';
  const e = get('SELECT * FROM equipment WHERE id = ?', equipment_id);
  if (!e) return res.status(404).json({ error: 'Barang tidak ditemukan.' });
  if (!(qty > 0)) return res.status(400).json({ error: 'Jumlah harus lebih dari 0.' });
  if (direction === 'keluar' && qty > e.stock_total)
    return res.status(400).json({ error: `Stok total hanya ${e.stock_total}.` });
  tx(() => {
    run(
      "INSERT INTO stock_movements (equipment_id, direction, kind, qty, reason) VALUES (?, ?, 'inventaris', ?, ?)",
      equipment_id,
      direction,
      qty,
      str(req.body.reason, 300) || (direction === 'masuk' ? 'Pembelian / tambah stok' : 'Rusak / hilang')
    );
    run('UPDATE equipment SET stock_total = stock_total ' + (direction === 'masuk' ? '+' : '-') + ' ? WHERE id = ?', qty, equipment_id);
  });
  res.status(201).json(svc.equipmentWithAvailability(get('SELECT * FROM equipment WHERE id = ?', equipment_id)));
});

/* ---- Maintenance ---- */
admin.get('/maintenance', (_req, res) => {
  res.json(
    all(
      `SELECT m.*, e.name AS equipment_name FROM maintenance m JOIN equipment e ON e.id = m.equipment_id
        ORDER BY (m.status = 'proses') DESC, m.start_date DESC, m.id DESC`
    )
  );
});

admin.post('/maintenance', (req, res) => {
  const equipment_id = int(req.body.equipment_id);
  const qty = Math.max(1, int(req.body.qty, 1));
  const e = get('SELECT * FROM equipment WHERE id = ?', equipment_id);
  if (!e) return res.status(404).json({ error: 'Barang tidak ditemukan.' });
  const description = str(req.body.description, 500);
  if (!description) return res.status(400).json({ error: 'Keterangan perawatan wajib diisi.' });
  const free = svc.availableQty(equipment_id);
  if (qty > free) return res.status(409).json({ error: `Hanya ${free} unit yang sedang di gudang.` });
  const start = svc.isValidDate(req.body.start_date) ? req.body.start_date : svc.today();
  const r = run(
    'INSERT INTO maintenance (equipment_id, qty, description, cost, start_date) VALUES (?, ?, ?, ?, ?)',
    equipment_id, qty, description, Math.max(0, int(req.body.cost)), start
  );
  res.status(201).json(get('SELECT * FROM maintenance WHERE id = ?', r.lastInsertRowid));
});

admin.put('/maintenance/:id', (req, res) => {
  const m = get('SELECT * FROM maintenance WHERE id = ?', req.params.id);
  if (!m) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  const status = req.body.status === 'selesai' ? 'selesai' : req.body.status === 'proses' ? 'proses' : m.status;
  run(
    'UPDATE maintenance SET status = ?, cost = ?, description = ?, end_date = ? WHERE id = ?',
    status,
    req.body.cost !== undefined ? Math.max(0, int(req.body.cost)) : m.cost,
    str(req.body.description, 500) || m.description,
    status === 'selesai' ? m.end_date || svc.today() : null,
    m.id
  );
  res.json(get('SELECT * FROM maintenance WHERE id = ?', m.id));
});

admin.delete('/maintenance/:id', (req, res) => {
  run('DELETE FROM maintenance WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

/* ---- Daftar booking ---- */
admin.get('/bookings', (req, res) => {
  const p = [];
  let where = '1=1';
  if (req.query.status) {
    where += ' AND b.status = ?';
    p.push(String(req.query.status));
  }
  if (req.query.q) {
    where += ' AND (b.code LIKE ? OR u.name LIKE ? OR u.phone LIKE ?)';
    p.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
  }
  const rows = all(
    `SELECT b.id FROM bookings b JOIN users u ON u.id = b.user_id WHERE ${where}
      ORDER BY CASE b.status WHEN 'menunggu' THEN 0 WHEN 'dikonfirmasi' THEN 1 WHEN 'diambil' THEN 2 ELSE 3 END, b.start_date DESC`,
    ...p
  );
  res.json(rows.map((r) => svc.getBooking(r.id)));
});

/** Admin bisa membuat booking untuk pelanggan (mis. pesan via WhatsApp / datang langsung). */
admin.post('/bookings', (req, res) => {
  const userId = int(req.body.user_id);
  if (!get('SELECT id FROM users WHERE id = ?', userId)) return res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
  res.status(201).json(svc.createBooking({ userId, ...req.body }));
});

admin.get('/bookings/:id', (req, res) => {
  const b = svc.getBooking(int(req.params.id));
  if (!b) return res.status(404).json({ error: 'Booking tidak ditemukan.' });
  res.json(b);
});

admin.post('/bookings/:id/status', (req, res) => {
  res.json(svc.changeBookingStatus(int(req.params.id), String(req.body.status), { late_fee: req.body.late_fee }));
});

admin.post('/bookings/:id/payments', (req, res) => {
  res.status(201).json(svc.addPayment(int(req.params.id), req.body));
});

/* ---- Keuangan ---- */
admin.get('/payments', (req, res) => {
  const from = svc.isValidDate(req.query.from) ? req.query.from : '0000-01-01';
  const to = svc.isValidDate(req.query.to) ? req.query.to : '9999-12-31';
  const rows = all(
    `SELECT p.*, b.code AS booking_code, u.name AS customer_name FROM payments p
       JOIN bookings b ON b.id = p.booking_id JOIN users u ON u.id = b.user_id
      WHERE substr(p.paid_at,1,10) BETWEEN ? AND ? ORDER BY p.paid_at DESC`,
    from,
    to
  );
  const by_method = {};
  for (const r of rows) by_method[r.method] = (by_method[r.method] || 0) + r.amount;
  res.json({ total: rows.reduce((s, r) => s + r.amount, 0), by_method, payments: rows });
});

admin.delete('/payments/:id', (req, res) => {
  run('DELETE FROM payments WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

admin.get('/outstanding', (_req, res) => {
  const rows = svc.outstandingBookings();
  res.json({ total: rows.reduce((s, b) => s + b.balance, 0), bookings: rows });
});

/* ---- Database pelanggan ---- */
admin.get('/customers', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%';
  const rows = all(
    `SELECT u.id, u.name, u.email, u.phone, u.address, u.id_number, u.notes, u.created_at,
            (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.status != 'dibatalkan') AS booking_count,
            (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.user_id = u.id) AS total_paid,
            (SELECT COALESCE(SUM(b.total),0) FROM bookings b WHERE b.user_id = u.id AND b.status != 'dibatalkan') AS total_billed
       FROM users u WHERE u.role = 'customer' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)
      ORDER BY u.created_at DESC`,
    q, q, q
  );
  res.json(rows.map((r) => ({ ...r, balance: Math.max(0, r.total_billed - r.total_paid) })));
});

admin.post('/customers', (req, res) => {
  const name = str(req.body.name, 100);
  const phone = str(req.body.phone, 30);
  let email = str(req.body.email, 150)?.toLowerCase();
  if (!name || !phone) return res.status(400).json({ error: 'Nama dan no. HP wajib diisi.' });
  // pelanggan walk-in tanpa email: buat email placeholder unik
  if (!email) email = `walkin-${Date.now()}-${crypto.randomBytes(2).toString('hex')}@lokal`;
  if (get('SELECT id FROM users WHERE email = ?', email)) return res.status(409).json({ error: 'Email sudah terdaftar.' });
  const password = str(req.body.password, 100) || crypto.randomBytes(6).toString('hex');
  const r = run(
    'INSERT INTO users (name, email, phone, address, id_number, notes, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
    name, email, phone, str(req.body.address, 300), str(req.body.id_number, 30), str(req.body.notes, 1000),
    auth.hashPassword(password)
  );
  res.status(201).json(auth.publicUser(get('SELECT * FROM users WHERE id = ?', r.lastInsertRowid)));
});

admin.put('/customers/:id', (req, res) => {
  const u = get("SELECT * FROM users WHERE id = ? AND role = 'customer'", req.params.id);
  if (!u) return res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
  const pick = (k, max) => (req.body[k] !== undefined ? str(req.body[k], max) : u[k]);
  run(
    'UPDATE users SET name=?, phone=?, address=?, id_number=?, notes=? WHERE id=?',
    pick('name', 100) || u.name, pick('phone', 30), pick('address', 300), pick('id_number', 30), pick('notes', 1000), u.id
  );
  res.json(auth.publicUser(get('SELECT * FROM users WHERE id = ?', u.id)));
});

admin.get('/customers/:id', (req, res) => {
  const u = get("SELECT * FROM users WHERE id = ? AND role = 'customer'", req.params.id);
  if (!u) return res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
  const bookings = all('SELECT id FROM bookings WHERE user_id = ? ORDER BY created_at DESC', u.id).map((r) =>
    svc.getBooking(r.id)
  );
  res.json({ ...auth.publicUser(u), bookings });
});

/* ---- Ulasan, pesan, pengaturan ---- */
admin.get('/reviews', (_req, res) => res.json(all('SELECT * FROM reviews ORDER BY approved, created_at DESC')));
admin.put('/reviews/:id', (req, res) => {
  run('UPDATE reviews SET approved = ? WHERE id = ?', req.body.approved ? 1 : 0, req.params.id);
  res.json(get('SELECT * FROM reviews WHERE id = ?', req.params.id));
});
admin.delete('/reviews/:id', (req, res) => {
  run('DELETE FROM reviews WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

admin.get('/messages', (_req, res) => res.json(all('SELECT * FROM messages ORDER BY handled, created_at DESC')));
admin.put('/messages/:id', (req, res) => {
  run('UPDATE messages SET handled = ? WHERE id = ?', req.body.handled ? 1 : 0, req.params.id);
  res.json(get('SELECT * FROM messages WHERE id = ?', req.params.id));
});

admin.get('/settings', (_req, res) => res.json(svc.getSettings()));
admin.put('/settings', (req, res) => res.json(svc.saveSettings(req.body)));

router.use('/admin', admin);

/* ---- Penanganan error ---- */
router.use((req, res) => res.status(404).json({ error: `Endpoint ${req.method} ${req.originalUrl} tidak ada.` }));
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  if (err instanceof svc.HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload gagal: ${err.message}` });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body JSON tidak valid.' });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
});

module.exports = router;
