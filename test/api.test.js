// Tes alur utama API. Jalankan: npm test
process.env.DB_FILE = ':memory:';
process.env.SEED_DEMO = '0';
delete process.env.ANTHROPIC_API_KEY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { today, addDays } = require('../src/services');

let server, base, adminToken, userToken;

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(base + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  adminToken = (await call('/auth/login', { method: 'POST', body: { email: 'admin@rental.local', password: 'admin123' } })).data.token;
});
after(() => server.close());

test('katalog publik menampilkan stok & harga', async () => {
  const { status, data } = await call('/equipment');
  assert.equal(status, 200);
  assert.ok(data.length > 0);
  const tenda = data.find((e) => e.name === 'Tenda Dome 4 Orang');
  assert.equal(tenda.available, 6);
  assert.equal(tenda.price_per_day, 55000);
});

test('daftar, login, dan validasi', async () => {
  const bad = await call('/auth/register', { method: 'POST', body: { name: 'X', email: 'salah', phone: '1', password: '123456' } });
  assert.equal(bad.status, 400);
  const r = await call('/auth/register', {
    method: 'POST',
    body: { name: 'Tester', email: 'tester@contoh.com', phone: '0811111111', password: 'rahasia1', id_number: '3201' },
  });
  assert.equal(r.status, 201);
  assert.ok(!('password_hash' in r.data.user));
  userToken = r.data.token;
  const dup = await call('/auth/register', { method: 'POST', body: { name: 'T', email: 'tester@contoh.com', phone: '1', password: 'rahasia1' } });
  assert.equal(dup.status, 409);
  const wrong = await call('/auth/login', { method: 'POST', body: { email: 'tester@contoh.com', password: 'salah123' } });
  assert.equal(wrong.status, 401);
  const me = await call('/me', { token: userToken });
  assert.equal(me.data.name, 'Tester');
});

test('pelanggan tidak bisa akses admin', async () => {
  assert.equal((await call('/admin/dashboard', { token: userToken })).status, 403);
  assert.equal((await call('/admin/dashboard')).status, 401);
});

test('alur sewa lengkap: booking → konfirmasi → ambil → bayar → kembali', async () => {
  const start = addDays(today(), 1);
  const end = addDays(today(), 3);
  const tenda = (await call('/equipment')).data.find((e) => e.name === 'Tenda Family 6 Orang'); // stok 3

  // stok berlebih ditolak
  const over = await call('/bookings', { method: 'POST', token: userToken, body: { start_date: start, end_date: end, items: [{ equipment_id: tenda.id, qty: 4 }] } });
  assert.equal(over.status, 409);

  const b = await call('/bookings', { method: 'POST', token: userToken, body: { start_date: start, end_date: end, items: [{ equipment_id: tenda.id, qty: 2 }] } });
  assert.equal(b.status, 201);
  assert.equal(b.data.days, 2);
  assert.equal(b.data.total, 90000 * 2 * 2);
  assert.equal(b.data.payment_status, 'belum');

  // stok untuk tanggal tsb berkurang, tanggal lain tidak
  const avail = await call(`/equipment/${tenda.id}?start=${start}&end=${end}`);
  assert.equal(avail.data.available, 1);
  const later = await call(`/equipment/${tenda.id}?start=${addDays(end, 1)}&end=${addDays(end, 2)}`);
  assert.equal(later.data.available, 3);

  // tidak boleh loncat status
  assert.equal((await call(`/admin/bookings/${b.data.id}/status`, { method: 'POST', token: adminToken, body: { status: 'dikembalikan' } })).status, 400);

  await call(`/admin/bookings/${b.data.id}/status`, { method: 'POST', token: adminToken, body: { status: 'dikonfirmasi' } });
  const dp = await call(`/admin/bookings/${b.data.id}/payments`, { method: 'POST', token: adminToken, body: { amount: 100000, method: 'transfer' } });
  assert.equal(dp.data.payment_status, 'dp');
  assert.equal(dp.data.balance, 260000);

  const outstanding = await call('/admin/outstanding', { token: adminToken });
  assert.ok(outstanding.data.bookings.some((x) => x.id === b.data.id));

  await call(`/admin/bookings/${b.data.id}/status`, { method: 'POST', token: adminToken, body: { status: 'diambil' } });
  const moves = await call(`/admin/stock-movements?equipment_id=${tenda.id}`, { token: adminToken });
  assert.ok(moves.data.some((m) => m.direction === 'keluar' && m.kind === 'sewa' && m.qty === 2));

  const done = await call(`/admin/bookings/${b.data.id}/status`, { method: 'POST', token: adminToken, body: { status: 'dikembalikan', late_fee: 0 } });
  assert.equal(done.data.status, 'dikembalikan');
  await call(`/admin/bookings/${b.data.id}/payments`, { method: 'POST', token: adminToken, body: { amount: 260000 } });
  const final = await call(`/bookings/${b.data.id}`, { token: userToken });
  assert.equal(final.data.payment_status, 'lunas');

  const dash = await call('/admin/dashboard', { token: adminToken });
  assert.equal(dash.data.income_today, 360000);
});

test('maintenance mengurangi stok tersedia', async () => {
  const eq = (await call('/admin/equipment', { token: adminToken })).data.find((e) => e.name === 'Carrier 80L'); // stok 5
  const m = await call('/admin/maintenance', { method: 'POST', token: adminToken, body: { equipment_id: eq.id, qty: 2, description: 'Jahit' } });
  assert.equal(m.status, 201);
  assert.equal((await call(`/equipment/${eq.id}`)).data.available, 3);
  await call(`/admin/maintenance/${m.data.id}`, { method: 'PUT', token: adminToken, body: { status: 'selesai' } });
  assert.equal((await call(`/equipment/${eq.id}`)).data.available, 5);
});

test('barang masuk/keluar inventaris mengubah stok total', async () => {
  const eq = (await call('/admin/equipment', { token: adminToken })).data.find((e) => e.name === 'Headlamp LED'); // 12
  await call('/admin/stock-movements', { method: 'POST', token: adminToken, body: { equipment_id: eq.id, qty: 3, direction: 'masuk', reason: 'Beli' } });
  const r = await call('/admin/stock-movements', { method: 'POST', token: adminToken, body: { equipment_id: eq.id, qty: 1, direction: 'keluar', reason: 'Rusak' } });
  assert.equal(r.data.stock_total, 14);
  const tooMany = await call('/admin/stock-movements', { method: 'POST', token: adminToken, body: { equipment_id: eq.id, qty: 99, direction: 'keluar' } });
  assert.equal(tooMany.status, 400);
});

test('pelanggan bisa membatalkan booking yang belum diambil', async () => {
  const eq = (await call('/equipment')).data[0];
  const b = await call('/bookings', { method: 'POST', token: userToken, body: { start_date: addDays(today(), 5), end_date: addDays(today(), 6), items: [{ equipment_id: eq.id, qty: 1 }] } });
  const c = await call(`/bookings/${b.data.id}/cancel`, { method: 'POST', token: userToken });
  assert.equal(c.data.status, 'dibatalkan');
});

test('ulasan perlu persetujuan admin', async () => {
  const before = (await call('/reviews')).data.length;
  await call('/reviews', { method: 'POST', token: userToken, body: { rating: 5, comment: 'Mantap!' } });
  assert.equal((await call('/reviews')).data.length, before);
  const pending = (await call('/admin/reviews', { token: adminToken })).data.find((r) => r.comment === 'Mantap!');
  await call(`/admin/reviews/${pending.id}`, { method: 'PUT', token: adminToken, body: { approved: true } });
  assert.equal((await call('/reviews')).data.length, before + 1);
});

test('chatbot menjawab stok & cara sewa tanpa API key', async () => {
  const r1 = await call('/chat', { method: 'POST', body: { message: 'tenda 4 orang ada?' } });
  assert.match(r1.data.reply, /Tenda Dome 4 Orang/);
  assert.doesNotMatch(r1.data.reply, /Tenda Dome 2 Orang/);
  const r2 = await call('/chat', { method: 'POST', body: { message: 'gimana cara sewanya?' } });
  assert.match(r2.data.reply, /Cara sewa/);
  assert.equal(r2.data.source, 'rules');
});

test('form kontak & pengaturan', async () => {
  assert.equal((await call('/contact', { method: 'POST', body: { name: 'A', contact: '08', message: 'Halo' } })).status, 201);
  await call('/admin/settings', { method: 'PUT', token: adminToken, body: { business_name: 'Toko Uji' } });
  assert.equal((await call('/info')).data.business_name, 'Toko Uji');
});
