// Logika bisnis: ketersediaan stok, booking, pembayaran, pengaturan.
const crypto = require('node:crypto');
const { all, get, run, tx } = require('./db');

const ACTIVE_STATUSES = ['menunggu', 'dikonfirmasi', 'diambil'];

const DEFAULT_SETTINGS = {
  business_name: 'Rimba Camp Rental',
  tagline: 'Sewa perlengkapan kamping lengkap, bersih, siap petualangan.',
  about:
    'Kami menyediakan tenda, carrier, sleeping bag, alat masak, dan perlengkapan outdoor lain yang dirawat setelah setiap pemakaian.',
  address: 'Jl. Contoh No. 1, Kota Anda',
  phone: '0812-0000-0000',
  whatsapp: '6281200000000',
  email: 'halo@contoh.com',
  instagram: 'rimbacamp',
  hours: 'Setiap hari 08.00 – 21.00',
  maps_query: 'Monas, Jakarta',
  bank_info: 'BCA 1234567890 a.n. Pemilik Usaha',
  late_fee_percent: '100',
  min_days: '1',
};

/* ---------- utilitas tanggal ---------- */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

function isValidDate(s) {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Selisih hari (end - start). 20 → 22 = 2 hari sewa. */
function diffDays(start, end) {
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000);
}

function rentalDays(start, end) {
  return Math.max(1, diffDays(start, end));
}

/* ---------- pengaturan ---------- */
function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

function saveSettings(obj) {
  const allowed = Object.keys(DEFAULT_SETTINGS);
  tx(() => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (!allowed.includes(k)) continue;
      run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        k,
        String(v ?? '')
      );
    }
  });
  return getSettings();
}

/* ---------- ketersediaan ---------- */
function maintenanceQty(equipmentId) {
  return (
    get(
      "SELECT COALESCE(SUM(qty),0) AS q FROM maintenance WHERE equipment_id = ? AND status = 'proses'",
      equipmentId
    ).q || 0
  );
}

/**
 * Jumlah unit tersedia untuk rentang [start, end).
 * Dihitung per hari (puncak pemakaian), barang yang sedang dibawa & terlambat
 * kembali tetap dianggap terpakai sampai dikembalikan.
 */
function availableQty(equipmentId, start, end, excludeBookingId = null) {
  const eq = get('SELECT stock_total FROM equipment WHERE id = ?', equipmentId);
  if (!eq) return 0;
  const base = eq.stock_total - maintenanceQty(equipmentId);
  const t = today();
  if (!start) start = t;
  if (!end || end <= start) end = addDays(start, 1);

  const rows = all(
    `SELECT b.id, b.start_date, b.end_date, b.status, bi.qty
       FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
      WHERE bi.equipment_id = ?
        AND b.status IN ('menunggu','dikonfirmasi','diambil')
        AND b.start_date < ?`,
    equipmentId,
    end
  ).filter((r) => r.id !== excludeBookingId);

  let peak = 0;
  for (let d = start; d < end; d = addDays(d, 1)) {
    let used = 0;
    for (const r of rows) {
      // barang yang sudah diambil dianggap belum kembali sampai dicatat kembali
      const effEnd = r.status === 'diambil' && r.end_date <= t ? addDays(t, 1) : r.end_date;
      if (r.start_date <= d && d < effEnd) used += r.qty;
    }
    if (used > peak) peak = used;
  }
  return Math.max(0, base - peak);
}

function equipmentWithAvailability(eq, start, end) {
  const inMaint = maintenanceQty(eq.id);
  return {
    ...eq,
    in_maintenance: inMaint,
    available: availableQty(eq.id, start, end),
  };
}

/* ---------- booking ---------- */
function newBookingCode() {
  const d = today().replace(/-/g, '').slice(2);
  return `RK${d}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * items: [{ equipment_id, qty }]
 */
function createBooking({ userId, start_date, end_date, items, pickup_method, notes }) {
  if (!isValidDate(start_date) || !isValidDate(end_date))
    throw new HttpError(400, 'Tanggal sewa tidak valid.');
  if (start_date < today()) throw new HttpError(400, 'Tanggal mulai tidak boleh di masa lalu.');
  if (end_date <= start_date) throw new HttpError(400, 'Tanggal kembali harus setelah tanggal ambil.');
  if (!Array.isArray(items) || items.length === 0)
    throw new HttpError(400, 'Pilih minimal satu barang.');

  const settings = getSettings();
  const days = rentalDays(start_date, end_date);
  if (days < Number(settings.min_days || 1))
    throw new HttpError(400, `Minimal sewa ${settings.min_days} hari.`);

  // gabungkan item duplikat
  const merged = new Map();
  for (const it of items) {
    const id = Number(it.equipment_id);
    const qty = Math.floor(Number(it.qty));
    if (!id || !(qty > 0)) throw new HttpError(400, 'Jumlah barang tidak valid.');
    merged.set(id, (merged.get(id) || 0) + qty);
  }

  return tx(() => {
    let subtotal = 0;
    const lines = [];
    for (const [id, qty] of merged) {
      const eq = get('SELECT * FROM equipment WHERE id = ? AND active = 1', id);
      if (!eq) throw new HttpError(404, `Barang #${id} tidak ditemukan.`);
      const avail = availableQty(id, start_date, end_date);
      if (qty > avail)
        throw new HttpError(409, `Stok "${eq.name}" tidak cukup untuk tanggal tersebut (tersedia ${avail}).`);
      const line = eq.price_per_day * qty * days;
      subtotal += line;
      lines.push({ id, qty, price: eq.price_per_day, line });
    }
    const code = newBookingCode();
    const r = run(
      `INSERT INTO bookings (code, user_id, start_date, end_date, days, subtotal, total, pickup_method, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      code,
      userId,
      start_date,
      end_date,
      days,
      subtotal,
      subtotal,
      pickup_method === 'antar' ? 'antar' : 'ambil',
      notes ? String(notes).slice(0, 500) : null
    );
    const bookingId = Number(r.lastInsertRowid);
    for (const l of lines) {
      run(
        'INSERT INTO booking_items (booking_id, equipment_id, qty, price_per_day, line_total) VALUES (?, ?, ?, ?, ?)',
        bookingId,
        l.id,
        l.qty,
        l.price,
        l.line
      );
    }
    return getBooking(bookingId);
  });
}

function paymentStatus(total, paid) {
  if (paid >= total && total > 0) return 'lunas';
  if (paid > 0) return 'dp';
  return 'belum';
}

function decorateBooking(b) {
  if (!b) return null;
  const paid = get('SELECT COALESCE(SUM(amount),0) AS p FROM payments WHERE booking_id = ?', b.id).p;
  const t = today();
  return {
    ...b,
    paid,
    balance: Math.max(0, b.total - paid),
    payment_status: b.status === 'dibatalkan' ? 'batal' : paymentStatus(b.total, paid),
    is_late_return: b.status === 'diambil' && b.end_date < t,
    late_days: b.status === 'diambil' && b.end_date < t ? diffDays(b.end_date, t) : 0,
  };
}

function getBooking(id) {
  const b = get(
    `SELECT b.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email
       FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?`,
    id
  );
  if (!b) return null;
  const out = decorateBooking(b);
  out.items = all(
    `SELECT bi.*, e.name, e.image_url, e.category FROM booking_items bi
       JOIN equipment e ON e.id = bi.equipment_id WHERE bi.booking_id = ?`,
    id
  );
  out.payments = all('SELECT * FROM payments WHERE booking_id = ? ORDER BY paid_at', id);
  return out;
}

const TRANSITIONS = {
  menunggu: ['dikonfirmasi', 'dibatalkan'],
  dikonfirmasi: ['diambil', 'dibatalkan', 'menunggu'],
  diambil: ['dikembalikan'],
  dikembalikan: [],
  dibatalkan: [],
};

/** Ubah status booking + catat keluar/masuk barang secara otomatis. */
function changeBookingStatus(id, status, { late_fee } = {}) {
  return tx(() => {
    const b = get('SELECT * FROM bookings WHERE id = ?', id);
    if (!b) throw new HttpError(404, 'Booking tidak ditemukan.');
    if (!TRANSITIONS[b.status]?.includes(status))
      throw new HttpError(400, `Status "${b.status}" tidak bisa diubah ke "${status}".`);

    const items = all('SELECT * FROM booking_items WHERE booking_id = ?', id);

    if (status === 'dikonfirmasi' || status === 'diambil') {
      // cek ulang stok (selain booking ini) — kalau ada perubahan sejak dipesan
      for (const it of items) {
        const avail = availableQty(it.equipment_id, b.start_date, b.end_date, b.id);
        if (it.qty > avail) {
          const eq = get('SELECT name FROM equipment WHERE id = ?', it.equipment_id);
          throw new HttpError(409, `Stok "${eq.name}" tidak cukup (tersedia ${avail}).`);
        }
      }
    }

    if (status === 'diambil') {
      for (const it of items)
        run(
          "INSERT INTO stock_movements (equipment_id, direction, kind, qty, reason, booking_id) VALUES (?, 'keluar', 'sewa', ?, ?, ?)",
          it.equipment_id,
          it.qty,
          `Disewa ${b.code}`,
          b.id
        );
      run("UPDATE bookings SET status = ?, picked_up_at = datetime('now','localtime') WHERE id = ?", status, id);
    } else if (status === 'dikembalikan') {
      for (const it of items)
        run(
          "INSERT INTO stock_movements (equipment_id, direction, kind, qty, reason, booking_id) VALUES (?, 'masuk', 'sewa', ?, ?, ?)",
          it.equipment_id,
          it.qty,
          `Kembali ${b.code}`,
          b.id
        );
      let fee;
      if (late_fee !== undefined && late_fee !== null && late_fee !== '') {
        fee = Math.max(0, Math.floor(Number(late_fee) || 0));
      } else {
        const lateDays = Math.max(0, diffDays(b.end_date, today()));
        const perDay = items.reduce((s, it) => s + it.price_per_day * it.qty, 0);
        fee = Math.round((lateDays * perDay * Number(getSettings().late_fee_percent || 0)) / 100);
      }
      run(
        "UPDATE bookings SET status = ?, returned_at = datetime('now','localtime'), late_fee = ?, total = subtotal + ? WHERE id = ?",
        status,
        fee,
        fee,
        id
      );
    } else {
      run('UPDATE bookings SET status = ? WHERE id = ?', status, id);
    }
    return getBooking(id);
  });
}

function addPayment(bookingId, { amount, method, note, paid_at }) {
  const b = get('SELECT * FROM bookings WHERE id = ?', bookingId);
  if (!b) throw new HttpError(404, 'Booking tidak ditemukan.');
  const amt = Math.floor(Number(amount));
  if (!(amt > 0)) throw new HttpError(400, 'Nominal pembayaran tidak valid.');
  run(
    "INSERT INTO payments (booking_id, amount, method, note, paid_at) VALUES (?, ?, ?, ?, COALESCE(?, datetime('now','localtime')))",
    bookingId,
    amt,
    method || 'tunai',
    note || null,
    paid_at || null
  );
  return getBooking(bookingId);
}

/** Pembayaran nunggak: booking aktif/selesai yang belum lunas. */
function outstandingBookings() {
  const rows = all(
    `SELECT b.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email
       FROM bookings b JOIN users u ON u.id = b.user_id
      WHERE b.status != 'dibatalkan'
      ORDER BY b.start_date`
  )
    .map(decorateBooking)
    .filter((b) => b.balance > 0);
  const t = today();
  return rows.map((b) => ({
    ...b,
    // jatuh tempo = saat barang diambil (tanggal mulai)
    overdue: b.start_date <= t || ['diambil', 'dikembalikan'].includes(b.status),
    overdue_days: b.start_date < t ? diffDays(b.start_date, t) : 0,
  }));
}

module.exports = {
  ACTIVE_STATUSES,
  DEFAULT_SETTINGS,
  HttpError,
  today,
  addDays,
  diffDays,
  isValidDate,
  rentalDays,
  getSettings,
  saveSettings,
  availableQty,
  maintenanceQty,
  equipmentWithAvailability,
  createBooking,
  getBooking,
  decorateBooking,
  changeBookingStatus,
  addPayment,
  outstandingBookings,
};
