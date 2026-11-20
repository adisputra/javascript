// Data awal: akun admin, katalog contoh, dan (opsional) data demo.
const { get, run, tx, db } = require('./db');
const { hashPassword } = require('./auth');
const { today, addDays } = require('./services');

const EQUIPMENT = [
  ['Tenda Dome 2 Orang', 'Tenda', 'Tenda double layer, mudah dipasang, cocok untuk pendakian ringan.', 35000, 8, '/img/tenda.svg'],
  ['Tenda Dome 4 Orang', 'Tenda', 'Kapasitas 4 orang, frame fiberglass, flysheet waterproof 2000mm.', 55000, 6, '/img/tenda.svg'],
  ['Tenda Family 6 Orang', 'Tenda', 'Ruang luas dengan teras, ideal untuk camping keluarga.', 90000, 3, '/img/tenda.svg'],
  ['Carrier 60L', 'Tas & Carrier', 'Carrier dengan back system nyaman dan raincover.', 30000, 10, '/img/carrier.svg'],
  ['Carrier 80L', 'Tas & Carrier', 'Untuk pendakian multi-hari, termasuk raincover.', 40000, 5, '/img/carrier.svg'],
  ['Sleeping Bag Polar', 'Tidur', 'Sleeping bag hangat hingga suhu 10°C.', 15000, 15, '/img/sleepingbag.svg'],
  ['Matras Foil', 'Tidur', 'Matras ringan berlapis aluminium foil.', 5000, 20, '/img/matras.svg'],
  ['Kompor Portable + Gas', 'Masak', 'Kompor lipat portable, sudah termasuk 1 tabung gas.', 20000, 8, '/img/kompor.svg'],
  ['Cooking Set (Nesting)', 'Masak', 'Panci, wajan, dan mangkok set untuk 2–3 orang.', 15000, 8, '/img/kompor.svg'],
  ['Headlamp LED', 'Penerangan', 'Headlamp terang dengan 3 mode cahaya.', 10000, 12, '/img/lampu.svg'],
  ['Lampu Tenda Gantung', 'Penerangan', 'Lampu LED rechargeable untuk di dalam tenda.', 10000, 10, '/img/lampu.svg'],
  ['Kursi Lipat Camping', 'Furnitur', 'Kursi lipat kokoh, beban maks. 100kg.', 15000, 10, '/img/kursi.svg'],
];

const REVIEWS = [
  ['Dimas', 5, 'Tenda bersih dan wangi, prosesnya cepat. Bakal sewa lagi!'],
  ['Sari', 5, 'Adminnya ramah, dijelasin cara pasang tenda. Mantap.'],
  ['Rizky', 4, 'Harga bersahabat, barang lengkap. Semoga ada lebih banyak pilihan carrier.'],
];

function ensureSeed({ demo = process.env.SEED_DEMO !== '0' } = {}) {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@rental.local').toLowerCase();
  if (!get("SELECT id FROM users WHERE role = 'admin'")) {
    run(
      "INSERT INTO users (name, email, phone, password_hash, role) VALUES ('Pemilik', ?, '-', ?, 'admin')",
      adminEmail,
      hashPassword(process.env.ADMIN_PASSWORD || 'admin123')
    );
  }
  if (get('SELECT COUNT(*) AS n FROM equipment').n > 0) return;

  tx(() => {
    for (const [name, category, description, price, stock, img] of EQUIPMENT) {
      const r = run(
        'INSERT INTO equipment (name, category, description, price_per_day, stock_total, image_url) VALUES (?, ?, ?, ?, ?, ?)',
        name, category, description, price, stock, img
      );
      run(
        "INSERT INTO stock_movements (equipment_id, direction, kind, qty, reason) VALUES (?, 'masuk', 'inventaris', ?, 'Stok awal')",
        r.lastInsertRowid,
        stock
      );
    }
    for (const [name, rating, comment] of REVIEWS)
      run('INSERT INTO reviews (name, rating, comment, approved) VALUES (?, ?, ?, 1)', name, rating, comment);

    if (!demo) return;
    // Pelanggan & transaksi contoh supaya dashboard admin langsung terisi
    const pw = hashPassword('pelanggan123');
    const c1 = run(
      "INSERT INTO users (name, email, phone, address, id_number, password_hash) VALUES ('Budi Santoso', 'budi@contoh.com', '081234567890', 'Jl. Melati 5', '3201xxxxxxxx0001', ?)",
      pw
    ).lastInsertRowid;
    const c2 = run(
      "INSERT INTO users (name, email, phone, address, id_number, password_hash) VALUES ('Ayu Lestari', 'ayu@contoh.com', '081298765432', 'Jl. Kenanga 12', '3201xxxxxxxx0002', ?)",
      pw
    ).lastInsertRowid;
    const t = today();
    const mk = (code, user, start, end, status, items, paid) => {
      const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400000));
      let subtotal = 0;
      const lines = items.map(([eqId, qty]) => {
        const price = get('SELECT price_per_day FROM equipment WHERE id = ?', eqId).price_per_day;
        subtotal += price * qty * days;
        return [eqId, qty, price, price * qty * days];
      });
      const b = run(
        'INSERT INTO bookings (code, user_id, start_date, end_date, days, subtotal, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        code, user, start, end, days, subtotal, subtotal, status
      ).lastInsertRowid;
      for (const l of lines)
        run('INSERT INTO booking_items (booking_id, equipment_id, qty, price_per_day, line_total) VALUES (?, ?, ?, ?, ?)', b, ...l);
      if (status === 'diambil' || status === 'dikembalikan') {
        for (const [eqId, qty] of items) {
          run("INSERT INTO stock_movements (equipment_id, direction, kind, qty, reason, booking_id, created_at) VALUES (?, 'keluar', 'sewa', ?, ?, ?, ?)", eqId, qty, `Disewa ${code}`, b, start + ' 09:00:00');
          if (status === 'dikembalikan')
            run("INSERT INTO stock_movements (equipment_id, direction, kind, qty, reason, booking_id, created_at) VALUES (?, 'masuk', 'sewa', ?, ?, ?, ?)", eqId, qty, `Kembali ${code}`, b, end + ' 17:00:00');
        }
      }
      if (paid) run("INSERT INTO payments (booking_id, amount, method, paid_at) VALUES (?, ?, 'transfer', ?)", b, paid === 'full' ? subtotal : paid, start + ' 10:00:00');
    };
    mk('RKDEMO-0001', c1, addDays(t, -20), addDays(t, -18), 'dikembalikan', [[2, 1], [6, 4]], 'full');
    mk('RKDEMO-0002', c2, addDays(t, -5), addDays(t, -3), 'dikembalikan', [[1, 1], [4, 2]], 50000);
    mk('RKDEMO-0003', c1, addDays(t, -1), addDays(t, 2), 'diambil', [[3, 1], [8, 1], [12, 4]], 100000);
    mk('RKDEMO-0004', c2, addDays(t, 3), addDays(t, 5), 'menunggu', [[2, 2], [7, 4]], 0);
    run("INSERT INTO maintenance (equipment_id, qty, description, cost) VALUES (1, 1, 'Ganti frame patah & jahit flysheet', 75000)");
  });
}

if (require.main === module) {
  if (process.argv.includes('--reset')) {
    db.exec(`DELETE FROM sessions; DELETE FROM payments; DELETE FROM booking_items; DELETE FROM stock_movements;
             DELETE FROM bookings; DELETE FROM maintenance; DELETE FROM reviews; DELETE FROM messages;
             DELETE FROM equipment; DELETE FROM users; DELETE FROM sqlite_sequence;`);
  }
  ensureSeed();
  console.log('Seed selesai.');
}

module.exports = { ensureSeed };
