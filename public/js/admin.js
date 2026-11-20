/* Panel admin */
(function () {
  const { api, store, TOKEN_KEY, rupiah, esc, todayStr, addDays, fmtDate, fmtDateTime, toast, STATUS_LABEL, PAY_LABEL } = window.RK;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const view = $('#view');
  let current = 'dashboard';
  let equipmentCache = [];

  /* ---------- Modal ---------- */
  function openModal(title, html, { wide = false } = {}) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modalBox').classList.toggle('wide', wide);
    $('#modal').classList.add('open');
    return $('#modalBody');
  }
  function closeModal() { $('#modal').classList.remove('open'); $('#sidebar').classList.remove('open'); $('#overlay').classList.remove('open'); }
  $$('[data-close]').forEach((b) => (b.onclick = closeModal));
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('#overlay').onclick = closeModal;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  const formData = (form) => Object.fromEntries(new FormData(form));
  const errBox = (msg) => `<div class="alert err">${esc(msg)}</div>`;
  const waLink = (phone, text) => {
    let p = String(phone || '').replace(/\D/g, '');
    if (p.startsWith('0')) p = '62' + p.slice(1);
    return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
  };
  const table = (head, rows, empty = 'Belum ada data.') =>
    `<div class="card table-wrap"><table><thead><tr>${head.map((h) => (h.startsWith('#') ? `<th class="num">${h.slice(1)}</th>` : `<th>${h}</th>`)).join('')}</tr></thead>
     <tbody>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}" class="empty">${empty}</td></tr>`}</tbody></table></div>`;

  /* ---------- Auth ---------- */
  async function boot() {
    if (store.get(TOKEN_KEY)) {
      try {
        const me = await api('/me');
        if (me.role === 'admin') return showApp();
      } catch {}
      store.set(TOKEN_KEY, null);
    }
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
  }
  $('#adminLogin').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/login', { method: 'POST', body: formData(e.target) });
      if (r.user.role !== 'admin') throw new Error('Akun ini bukan admin.');
      store.set(TOKEN_KEY, r.token);
      showApp();
    } catch (err) {
      $('#loginAlert').innerHTML = errBox(err.message);
    }
  };
  $('#logout').onclick = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    store.set(TOKEN_KEY, null);
    location.reload();
  };

  function showApp() {
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    api('/admin/settings').then((s) => ($('#bizName').textContent = s.business_name)).catch(() => {});
    go(location.hash.slice(1) || 'dashboard');
  }

  /* ---------- Navigasi ---------- */
  const VIEWS = {};
  const TITLES = {
    dashboard: 'Dashboard', bookings: 'Daftar booking', finance: 'Uang masuk', outstanding: 'Pembayaran nunggak',
    equipment: 'Database peralatan', stock: 'Keluar / masuk barang', maintenance: 'Maintenance',
    customers: 'Database pelanggan', reviews: 'Ulasan & pesan', settings: 'Pengaturan',
  };
  function go(name) {
    if (!VIEWS[name]) name = 'dashboard';
    current = name;
    location.hash = name;
    $$('.side-link[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $('#viewTitle').textContent = TITLES[name];
    $('#viewActions').innerHTML = '';
    view.innerHTML = '<div class="empty">Memuat…</div>';
    closeModal();
    VIEWS[name]().catch((e) => {
      if (e.status === 401 || e.status === 403) { store.set(TOKEN_KEY, null); return boot(); }
      view.innerHTML = errBox(e.message);
    });
    refreshCounts();
  }
  const reload = () => go(current);
  $$('.side-link[data-view]').forEach((b) => (b.onclick = () => go(b.dataset.view)));
  $('#sideToggle').onclick = () => { $('#sidebar').classList.add('open'); $('#overlay').classList.add('open'); };

  async function refreshCounts() {
    try {
      const d = await api('/admin/dashboard');
      const set = (id, n) => { $(id).textContent = n; $(id).classList.toggle('hidden', !n); };
      set('#cntPending', d.bookings_pending);
      set('#cntOutstanding', d.outstanding_count);
      set('#cntInbox', d.unread_messages + d.pending_reviews);
    } catch {}
  }

  async function loadEquipment() {
    equipmentCache = await api('/admin/equipment');
    return equipmentCache;
  }
  const equipmentOptions = (selected) =>
    equipmentCache.filter((e) => e.active).map((e) => `<option value="${e.id}" ${+selected === e.id ? 'selected' : ''}>${esc(e.name)} (stok ${e.stock_total})</option>`).join('');

  /* =========================================================
   *  DASHBOARD
   * ========================================================= */
  VIEWS.dashboard = async () => {
    const d = await api('/admin/dashboard');
    const max = Math.max(1, ...d.income_by_month.map((m) => m.total));
    const monthName = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('id-ID', { month: 'short' });
    const kpi = (label, value, sub = '', cls = '') => `<div class="card kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
    view.innerHTML = `
      <div class="kpis">
        ${kpi('Uang masuk hari ini', rupiah(d.income_today), fmtDate(d.today), 'good')}
        ${kpi('Uang masuk bulan ini', rupiah(d.income_month), 'Total sepanjang waktu ' + rupiah(d.income_total))}
        ${kpi('Pembayaran nunggak', rupiah(d.outstanding_total), d.outstanding_count + ' booking belum lunas', d.outstanding_total ? 'bad' : '')}
        ${kpi('Booking menunggu', d.bookings_pending, 'perlu dikonfirmasi', d.bookings_pending ? 'warn' : '')}
        ${kpi('Sedang disewa', d.bookings_active, d.late_returns ? `<span style="color:var(--danger)">${d.late_returns} terlambat kembali</span>` : 'tidak ada keterlambatan')}
        ${kpi('Unit di luar / maintenance', `${d.units_out} / ${d.units_maintenance}`, `dari ${d.units_total} unit (${d.equipment_types} jenis)`)}
        ${kpi('Pelanggan', d.customers, 'terdaftar')}
        ${kpi('Kotak masuk', d.unread_messages + d.pending_reviews, `${d.unread_messages} pesan • ${d.pending_reviews} ulasan baru`)}
      </div>
      <div class="panel-grid">
        <div class="card pad panel">
          <h3>Uang masuk 6 bulan terakhir</h3>
          <div class="bars">${d.income_by_month.map((m) => `<div class="bar" title="${rupiah(m.total)}"><span class="amt">${m.total ? (m.total / 1000).toLocaleString('id-ID') + 'rb' : ''}</span><div class="fill" style="height:${(m.total / max) * 100}%"></div><span class="lbl">${monthName(m.month)}</span></div>`).join('')}</div>
        </div>
        <div class="card pad panel">
          <h3>Jadwal hari ini</h3>
          <b class="small">Pengambilan (${d.pickups_today.length})</b>
          <ul class="list-plain">${d.pickups_today.map((b) => `<li><a href="#" data-booking="${b.id}">${esc(b.code)}</a><span class="muted">${esc(b.customer_name)}</span></li>`).join('') || '<li class="muted small">Tidak ada</li>'}</ul>
          <b class="small" style="display:block;margin-top:12px">Pengembalian (${d.returns_today.length})</b>
          <ul class="list-plain">${d.returns_today.map((b) => `<li><a href="#" data-booking="${b.id}">${esc(b.code)}</a><span class="muted">${esc(b.customer_name)}</span></li>`).join('') || '<li class="muted small">Tidak ada</li>'}</ul>
        </div>
      </div>`;
    $$('[data-booking]', view).forEach((a) => (a.onclick = (e) => { e.preventDefault(); bookingDetail(+a.dataset.booking); }));
  };

  /* =========================================================
   *  BOOKING
   * ========================================================= */
  let bookingFilter = { status: '', q: '' };
  VIEWS.bookings = async () => {
    $('#viewActions').innerHTML = '<button class="btn" id="newBooking">+ Booking baru</button>';
    $('#newBooking').onclick = newBookingForm;
    const qs = new URLSearchParams(bookingFilter);
    const list = await api('/admin/bookings?' + qs);
    view.innerHTML = `
      <div class="toolbar">
        <select id="fStatus"><option value="">Semua status</option>${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${bookingFilter.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input id="fQ" type="search" placeholder="Cari kode / nama / HP" value="${esc(bookingFilter.q)}" />
      </div>
      ${table(['Kode', 'Pelanggan', 'Tanggal', 'Barang', 'Status', '#Total', 'Bayar', ''],
        list.map((b) => `<tr>
          <td><b>${esc(b.code)}</b><div class="small muted">${fmtDateTime(b.created_at)}</div></td>
          <td>${esc(b.customer_name)}<div class="small muted">${esc(b.customer_phone || '')}</div></td>
          <td>${fmtDate(b.start_date)} – ${fmtDate(b.end_date)}<div class="small muted">${b.days} hari${b.is_late_return ? ` • <span style="color:var(--danger)">telat ${b.late_days} hari</span>` : ''}</div></td>
          <td class="small">${b.items.map((i) => `${esc(i.name)} ×${i.qty}`).join('<br>')}</td>
          <td><span class="badge ${b.status}">${STATUS_LABEL[b.status]}</span></td>
          <td class="num">${rupiah(b.total)}</td>
          <td><span class="badge ${b.payment_status}">${PAY_LABEL[b.payment_status]}</span>${b.balance && b.status !== 'dibatalkan' ? `<div class="small muted">sisa ${rupiah(b.balance)}</div>` : ''}</td>
          <td><button class="btn btn-sm btn-ghost" data-detail="${b.id}">Kelola</button></td>
        </tr>`), 'Belum ada booking.')}`;
    $('#fStatus').onchange = (e) => { bookingFilter.status = e.target.value; reload(); };
    let t;
    $('#fQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { bookingFilter.q = e.target.value; reload(); }, 350); };
    $$('[data-detail]', view).forEach((b) => (b.onclick = () => bookingDetail(+b.dataset.detail)));
  };

  async function bookingDetail(id) {
    const b = await api('/admin/bookings/' + id);
    const actions = {
      menunggu: [['dikonfirmasi', 'Konfirmasi', 'btn'], ['dibatalkan', 'Batalkan', 'btn btn-ghost']],
      dikonfirmasi: [['diambil', 'Barang diambil (keluar)', 'btn'], ['menunggu', 'Kembalikan ke menunggu', 'btn btn-ghost'], ['dibatalkan', 'Batalkan', 'btn btn-ghost']],
      diambil: [['dikembalikan', 'Barang dikembalikan (masuk)', 'btn']],
    }[b.status] || [];
    const body = openModal(`Booking ${b.code}`, `
      <div id="bAlert"></div>
      <div class="detail-grid">
        <div><div class="k">Pelanggan</div>${esc(b.customer_name)}<div class="small"><a target="_blank" rel="noopener" href="${waLink(b.customer_phone, `Halo ${b.customer_name}, terkait booking ${b.code}…`)}">${esc(b.customer_phone || '')}</a></div></div>
        <div><div class="k">Tanggal</div>${fmtDate(b.start_date)} – ${fmtDate(b.end_date)} (${b.days} hari)</div>
        <div><div class="k">Status</div><span class="badge ${b.status}">${STATUS_LABEL[b.status]}</span>${b.is_late_return ? `<div class="small" style="color:var(--danger)">Telat ${b.late_days} hari</div>` : ''}</div>
        <div><div class="k">Pengambilan</div>${b.pickup_method === 'antar' ? 'Diantar' : 'Ambil di toko'}</div>
        ${b.picked_up_at ? `<div><div class="k">Diambil</div>${fmtDateTime(b.picked_up_at)}</div>` : ''}
        ${b.returned_at ? `<div><div class="k">Dikembalikan</div>${fmtDateTime(b.returned_at)}</div>` : ''}
      </div>
      ${b.notes ? `<p class="small"><b>Catatan:</b> ${esc(b.notes)}</p>` : ''}
      ${table(['Barang', '#Qty', '#Harga/hari', '#Subtotal'], b.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${i.qty}</td><td class="num">${rupiah(i.price_per_day)}</td><td class="num">${rupiah(i.line_total)}</td></tr>`))}
      <div class="summary" style="margin:14px 0">
        <div><span class="muted">Subtotal</span><span>${rupiah(b.subtotal)}</span></div>
        ${b.late_fee ? `<div><span class="muted">Denda keterlambatan</span><span>${rupiah(b.late_fee)}</span></div>` : ''}
        <div class="total"><span>Total</span><span>${rupiah(b.total)}</span></div>
        <div><span class="muted">Sudah dibayar</span><span>${rupiah(b.paid)}</span></div>
        <div><b>Sisa tagihan</b><b style="color:${b.balance ? 'var(--danger)' : 'var(--primary)'}">${rupiah(b.balance)}</b></div>
      </div>
      ${actions.length ? `<div class="row" style="margin-bottom:16px">${b.status === 'diambil' ? `<div style="flex:1;min-width:180px"><label class="small">Denda (kosongkan = hitung otomatis)</label><input id="lateFee" type="number" min="0" placeholder="otomatis" /></div>` : ''}${actions.map(([s, l, c]) => `<button class="${c}" data-status="${s}">${l}</button>`).join('')}</div>` : ''}
      <h3 style="font-size:1rem">Pembayaran</h3>
      ${b.payments.length ? `<ul class="list-plain">${b.payments.map((p) => `<li><span>${fmtDateTime(p.paid_at)} • ${esc(p.method)}${p.note ? ' • ' + esc(p.note) : ''}</span><b>${rupiah(p.amount)}</b></li>`).join('')}</ul>` : '<p class="small muted">Belum ada pembayaran.</p>'}
      ${b.status !== 'dibatalkan' && b.balance > 0 ? `
      <form id="payForm" class="row" style="margin-top:12px;align-items:end">
        <div style="flex:1;min-width:120px"><label class="small">Nominal</label><input name="amount" type="number" min="1" value="${b.balance}" required /></div>
        <div style="min-width:120px"><label class="small">Metode</label><select name="method"><option>tunai</option><option>transfer</option><option>qris</option><option>e-wallet</option></select></div>
        <div style="flex:1;min-width:120px"><label class="small">Catatan</label><input name="note" placeholder="DP / pelunasan" /></div>
        <button class="btn">Catat bayar</button>
      </form>` : ''}`, { wide: true });

    $$('[data-status]', body).forEach((btn) => (btn.onclick = async () => {
      if (btn.dataset.status === 'dibatalkan' && !confirm('Batalkan booking ini?')) return;
      try {
        const payload = { status: btn.dataset.status };
        if (btn.dataset.status === 'dikembalikan' && $('#lateFee').value !== '') payload.late_fee = $('#lateFee').value;
        await api(`/admin/bookings/${id}/status`, { method: 'POST', body: payload });
        toast('Status diperbarui');
        if (current !== 'dashboard') reload(); else refreshCounts();
        bookingDetail(id);
      } catch (e) { $('#bAlert').innerHTML = errBox(e.message); }
    }));
    const pf = $('#payForm', body);
    if (pf) pf.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`/admin/bookings/${id}/payments`, { method: 'POST', body: formData(pf) });
        toast('Pembayaran dicatat');
        if (current !== 'dashboard') reload(); else refreshCounts();
        bookingDetail(id);
      } catch (err) { $('#bAlert').innerHTML = errBox(err.message); }
    };
  }

  async function newBookingForm() {
    const [customers] = await Promise.all([api('/admin/customers'), loadEquipment()]);
    const body = openModal('Booking baru (offline / WhatsApp)', `
      <div id="nbAlert"></div>
      <form id="nbForm">
        <div class="field"><label>Pelanggan</label><select name="user_id" required><option value="">— pilih —</option>${customers.map((c) => `<option value="${c.id}">${esc(c.name)} • ${esc(c.phone || '')}</option>`).join('')}</select>
          <div class="small muted" style="margin-top:4px">Belum terdaftar? Tambahkan dulu di <a href="#customers" id="toCust">Database pelanggan</a>.</div></div>
        <div class="grid-2">
          <div class="field"><label>Tanggal ambil</label><input type="date" name="start_date" value="${todayStr()}" required /></div>
          <div class="field"><label>Tanggal kembali</label><input type="date" name="end_date" value="${addDays(todayStr(), 2)}" required /></div>
        </div>
        <label>Barang</label>
        <div id="nbItems"></div>
        <button type="button" class="btn btn-sm btn-ghost" id="nbAdd" style="margin:6px 0 14px">+ Tambah barang</button>
        <div class="grid-2">
          <div class="field"><label>Pengambilan</label><select name="pickup_method"><option value="ambil">Ambil di toko</option><option value="antar">Diantar</option></select></div>
          <div class="field"><label>Catatan</label><input name="notes" /></div>
        </div>
        <button class="btn btn-block">Simpan booking</button>
      </form>`, { wide: true });
    $('#toCust', body).onclick = () => go('customers');
    const addRow = () => {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.marginBottom = '8px';
      row.innerHTML = `<select class="nbEq" style="flex:1;min-width:200px">${equipmentOptions()}</select><input class="nbQty" type="number" min="1" value="1" style="width:90px" /><button type="button" class="icon-btn">✕</button>`;
      row.querySelector('button').onclick = () => row.remove();
      $('#nbItems', body).appendChild(row);
    };
    addRow();
    $('#nbAdd', body).onclick = addRow;
    $('#nbForm', body).onsubmit = async (e) => {
      e.preventDefault();
      const data = formData(e.target);
      data.items = $$('#nbItems .row', body).map((r) => ({ equipment_id: +r.querySelector('.nbEq').value, qty: +r.querySelector('.nbQty').value }));
      try {
        const b = await api('/admin/bookings', { method: 'POST', body: data });
        toast(`Booking ${b.code} dibuat`);
        reload();
        bookingDetail(b.id);
      } catch (err) { $('#nbAlert').innerHTML = errBox(err.message); }
    };
  }

  /* =========================================================
   *  KEUANGAN
   * ========================================================= */
  let finRange = { from: todayStr().slice(0, 8) + '01', to: todayStr() };
  VIEWS.finance = async () => {
    const r = await api('/admin/payments?' + new URLSearchParams(finRange));
    view.innerHTML = `
      <form class="toolbar" id="finForm">
        <label class="small" style="margin:0">Dari</label><input type="date" name="from" value="${finRange.from}" />
        <label class="small" style="margin:0">Sampai</label><input type="date" name="to" value="${finRange.to}" />
        <button class="btn btn-ghost">Tampilkan</button>
        <button type="button" class="btn btn-ghost" id="csv">Unduh CSV</button>
      </form>
      <div class="kpis">
        <div class="card kpi good"><div class="label">Total uang masuk</div><div class="value">${rupiah(r.total)}</div><div class="sub">${r.payments.length} transaksi</div></div>
        ${Object.entries(r.by_method).map(([m, v]) => `<div class="card kpi"><div class="label">${esc(m)}</div><div class="value">${rupiah(v)}</div></div>`).join('')}
      </div>
      ${table(['Waktu', 'Booking', 'Pelanggan', 'Metode', 'Catatan', '#Nominal', ''],
        r.payments.map((p) => `<tr><td>${fmtDateTime(p.paid_at)}</td><td><a href="#" data-booking="${p.booking_id}">${esc(p.booking_code)}</a></td><td>${esc(p.customer_name)}</td><td>${esc(p.method)}</td><td class="small">${esc(p.note || '')}</td><td class="num">${rupiah(p.amount)}</td><td><button class="btn btn-sm btn-ghost" data-del="${p.id}" title="Hapus">🗑</button></td></tr>`),
        'Belum ada pembayaran pada periode ini.')}`;
    $('#finForm').onsubmit = (e) => { e.preventDefault(); finRange = formData(e.target); reload(); };
    $('#csv').onclick = () => {
      const rows = [['Waktu', 'Booking', 'Pelanggan', 'Metode', 'Catatan', 'Nominal'], ...r.payments.map((p) => [p.paid_at, p.booking_code, p.customer_name, p.method, p.note || '', p.amount])];
      const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
      a.download = `uang-masuk_${finRange.from}_${finRange.to}.csv`;
      a.click();
    };
    $$('[data-booking]', view).forEach((a) => (a.onclick = (e) => { e.preventDefault(); bookingDetail(+a.dataset.booking); }));
    $$('[data-del]', view).forEach((b) => (b.onclick = async () => {
      if (!confirm('Hapus catatan pembayaran ini?')) return;
      await api('/admin/payments/' + b.dataset.del, { method: 'DELETE' });
      toast('Pembayaran dihapus');
      reload();
    }));
  };

  VIEWS.outstanding = async () => {
    const r = await api('/admin/outstanding');
    view.innerHTML = `
      <div class="kpis"><div class="card kpi bad"><div class="label">Total tunggakan</div><div class="value">${rupiah(r.total)}</div><div class="sub">${r.bookings.length} booking belum lunas</div></div></div>
      ${table(['Kode', 'Pelanggan', 'Tanggal sewa', 'Status', '#Total', '#Dibayar', '#Sisa', 'Jatuh tempo', ''],
        r.bookings.map((b) => `<tr>
          <td><b>${esc(b.code)}</b></td>
          <td>${esc(b.customer_name)}<div class="small muted">${esc(b.customer_phone || '')}</div></td>
          <td>${fmtDate(b.start_date)} – ${fmtDate(b.end_date)}</td>
          <td><span class="badge ${b.status}">${STATUS_LABEL[b.status]}</span></td>
          <td class="num">${rupiah(b.total)}</td><td class="num">${rupiah(b.paid)}</td>
          <td class="num"><b style="color:var(--danger)">${rupiah(b.balance)}</b></td>
          <td>${b.overdue ? `<span class="badge bad">${b.overdue_days ? 'lewat ' + b.overdue_days + ' hari' : 'hari ini'}</span>` : '<span class="badge">belum jatuh tempo</span>'}</td>
          <td class="actions"><button class="btn btn-sm" data-detail="${b.id}">Catat bayar</button>
            <a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="${waLink(b.customer_phone, `Halo ${b.customer_name}, kami mengingatkan sisa pembayaran sewa ${b.code} sebesar ${rupiah(b.balance)}. Terima kasih 🙏`)}">Ingatkan WA</a></td>
        </tr>`), 'Tidak ada tunggakan. 🎉')}`;
    $$('[data-detail]', view).forEach((b) => (b.onclick = () => bookingDetail(+b.dataset.detail)));
  };

  /* =========================================================
   *  PERALATAN
   * ========================================================= */
  VIEWS.equipment = async () => {
    $('#viewActions').innerHTML = '<button class="btn" id="addEq">+ Tambah barang</button>';
    $('#addEq').onclick = () => equipmentForm();
    const list = await loadEquipment();
    view.innerHTML = table(['Foto', 'Nama', 'Kategori', '#Harga/hari', '#Stok total', '#Tersedia', '#Disewa/dipesan', '#Maintenance', 'Status', ''],
      list.map((e) => `<tr>
        <td><img class="thumb" src="${esc(e.image_url || '/img/tenda.svg')}" alt="" /></td>
        <td><b>${esc(e.name)}</b>${e.sku ? `<div class="small muted">${esc(e.sku)}</div>` : ''}</td>
        <td>${esc(e.category)}</td>
        <td class="num">${rupiah(e.price_per_day)}</td>
        <td class="num">${e.stock_total}</td>
        <td class="num"><b>${e.available}</b></td>
        <td class="num">${Math.max(0, e.stock_total - e.in_maintenance - e.available)}</td>
        <td class="num">${e.in_maintenance}</td>
        <td>${e.active ? '<span class="badge ok">Aktif</span>' : '<span class="badge">Arsip</span>'}</td>
        <td class="actions"><button class="btn btn-sm btn-ghost" data-edit="${e.id}">Edit</button><button class="btn btn-sm btn-ghost" data-stock="${e.id}">Stok</button><button class="btn btn-sm btn-ghost" data-del="${e.id}" title="Hapus">🗑</button></td>
      </tr>`), 'Belum ada barang.');
    $$('[data-edit]', view).forEach((b) => (b.onclick = () => equipmentForm(equipmentCache.find((e) => e.id === +b.dataset.edit))));
    $$('[data-stock]', view).forEach((b) => (b.onclick = () => stockForm(+b.dataset.stock)));
    $$('[data-del]', view).forEach((b) => (b.onclick = async () => {
      if (!confirm('Hapus barang ini? (Barang dengan riwayat sewa akan diarsipkan)')) return;
      const r = await api('/admin/equipment/' + b.dataset.del, { method: 'DELETE' });
      toast(r.message || 'Barang dihapus');
      reload();
    }));
  };

  function equipmentForm(e = null) {
    const cats = [...new Set(equipmentCache.map((x) => x.category))];
    const body = openModal(e ? 'Edit barang' : 'Tambah barang', `
      <div id="eqAlert"></div>
      <form id="eqForm">
        <div class="grid-2">
          <div class="field"><label>Nama barang *</label><input name="name" required value="${esc(e?.name || '')}" /></div>
          <div class="field"><label>Kategori</label><input name="category" list="catList" value="${esc(e?.category || '')}" placeholder="Tenda, Masak, …" /><datalist id="catList">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Harga sewa / hari (Rp) *</label><input name="price_per_day" type="number" min="0" required value="${e?.price_per_day ?? ''}" /></div>
          ${e ? `<div class="field"><label>Stok total</label><input disabled value="${e.stock_total}" /><div class="small muted">Ubah lewat tombol "Stok" (tercatat di keluar/masuk).</div></div>`
              : '<div class="field"><label>Stok awal</label><input name="stock_total" type="number" min="0" value="1" /></div>'}
        </div>
        <div class="grid-2">
          <div class="field"><label>Kode / SKU</label><input name="sku" value="${esc(e?.sku || '')}" /></div>
          <div class="field"><label>Status</label><select name="active"><option value="1">Aktif (tampil di website)</option><option value="0" ${e && !e.active ? 'selected' : ''}>Arsip (disembunyikan)</option></select></div>
        </div>
        <div class="field"><label>Deskripsi</label><textarea name="description">${esc(e?.description || '')}</textarea></div>
        <div class="field"><label>Foto produk</label>
          <div class="row">${e?.image_url ? `<img class="thumb" src="${esc(e.image_url)}" style="width:64px;height:64px;border-radius:10px;object-fit:cover" alt="" />` : ''}<input type="file" name="image" accept="image/*" style="flex:1" /></div>
          <div class="small muted" style="margin-top:4px">JPG/PNG/WebP, maks. 5 MB.</div></div>
        <button class="btn btn-block">Simpan</button>
      </form>`, { wide: true });
    $('#eqForm', body).onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      if (!fd.get('image')?.size) fd.delete('image');
      try {
        await api(e ? '/admin/equipment/' + e.id : '/admin/equipment', { method: e ? 'PUT' : 'POST', form: fd });
        toast('Data barang tersimpan');
        reload();
      } catch (err) { $('#eqAlert').innerHTML = errBox(err.message); }
    };
  }

  /* =========================================================
   *  KELUAR / MASUK BARANG
   * ========================================================= */
  function stockForm(equipmentId) {
    const body = openModal('Catat barang masuk / keluar', `
      <div id="stAlert"></div>
      <p class="small muted">Untuk pembelian baru, barang rusak, hilang, atau dijual. Ini mengubah <b>stok total</b>.
      Keluar/masuk karena disewa tercatat otomatis saat status booking berubah.</p>
      <form id="stForm">
        <div class="field"><label>Barang</label><select name="equipment_id" required>${equipmentOptions(equipmentId)}</select></div>
        <div class="grid-2">
          <div class="field"><label>Jenis</label><select name="direction"><option value="masuk">Masuk (tambah stok)</option><option value="keluar">Keluar (kurangi stok)</option></select></div>
          <div class="field"><label>Jumlah</label><input name="qty" type="number" min="1" value="1" required /></div>
        </div>
        <div class="field"><label>Keterangan</label><input name="reason" placeholder="Pembelian baru / rusak / hilang / dijual" /></div>
        <button class="btn btn-block">Simpan</button>
      </form>`);
    $('#stForm', body).onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api('/admin/stock-movements', { method: 'POST', body: formData(ev.target) });
        toast('Pergerakan stok dicatat');
        reload();
      } catch (err) { $('#stAlert').innerHTML = errBox(err.message); }
    };
  }

  let stockFilter = { equipment_id: '', from: '', to: '' };
  VIEWS.stock = async () => {
    await loadEquipment();
    $('#viewActions').innerHTML = '<button class="btn" id="addSt">+ Catat masuk / keluar</button>';
    $('#addSt').onclick = () => stockForm();
    const list = await api('/admin/stock-movements?' + new URLSearchParams(stockFilter));
    const kindLabel = { sewa: 'Sewa', inventaris: 'Inventaris' };
    view.innerHTML = `
      <form class="toolbar" id="stFilter">
        <select name="equipment_id"><option value="">Semua barang</option>${equipmentCache.map((e) => `<option value="${e.id}" ${+stockFilter.equipment_id === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
        <input type="date" name="from" value="${stockFilter.from}" /><input type="date" name="to" value="${stockFilter.to}" />
        <button class="btn btn-ghost">Filter</button>
      </form>
      ${table(['Waktu', 'Barang', 'Arah', 'Jenis', '#Jumlah', 'Keterangan'],
        list.map((m) => `<tr><td>${fmtDateTime(m.created_at)}</td><td>${esc(m.equipment_name)}</td>
          <td>${m.direction === 'masuk' ? '<span class="badge ok">⬇ Masuk</span>' : '<span class="badge warn">⬆ Keluar</span>'}</td>
          <td>${kindLabel[m.kind]}</td><td class="num">${m.qty}</td>
          <td class="small">${esc(m.reason || '')}${m.booking_id ? ` <a href="#" data-booking="${m.booking_id}">(lihat)</a>` : ''}</td></tr>`), 'Belum ada catatan.')}`;
    $('#stFilter').onsubmit = (e) => { e.preventDefault(); stockFilter = formData(e.target); reload(); };
    $$('[data-booking]', view).forEach((a) => (a.onclick = (e) => { e.preventDefault(); bookingDetail(+a.dataset.booking); }));
  };

  /* =========================================================
   *  MAINTENANCE
   * ========================================================= */
  VIEWS.maintenance = async () => {
    await loadEquipment();
    $('#viewActions').innerHTML = '<button class="btn" id="addMt">+ Catat maintenance</button>';
    $('#addMt').onclick = () => {
      const body = openModal('Catat maintenance', `
        <div id="mtAlert"></div>
        <p class="small muted">Unit yang sedang dirawat otomatis tidak bisa disewa sampai ditandai selesai.</p>
        <form id="mtForm">
          <div class="field"><label>Barang</label><select name="equipment_id" required>${equipmentOptions()}</select></div>
          <div class="grid-2">
            <div class="field"><label>Jumlah unit</label><input name="qty" type="number" min="1" value="1" /></div>
            <div class="field"><label>Mulai</label><input name="start_date" type="date" value="${todayStr()}" /></div>
          </div>
          <div class="field"><label>Keterangan *</label><input name="description" required placeholder="Cuci, jahit, ganti frame…" /></div>
          <div class="field"><label>Biaya (Rp)</label><input name="cost" type="number" min="0" value="0" /></div>
          <button class="btn btn-block">Simpan</button>
        </form>`);
      $('#mtForm', body).onsubmit = async (ev) => {
        ev.preventDefault();
        try { await api('/admin/maintenance', { method: 'POST', body: formData(ev.target) }); toast('Maintenance dicatat'); reload(); }
        catch (err) { $('#mtAlert').innerHTML = errBox(err.message); }
      };
    };
    const list = await api('/admin/maintenance');
    const totalCost = list.reduce((s, m) => s + m.cost, 0);
    view.innerHTML = `
      <div class="kpis">
        <div class="card kpi warn"><div class="label">Sedang dirawat</div><div class="value">${list.filter((m) => m.status === 'proses').reduce((s, m) => s + m.qty, 0)} unit</div></div>
        <div class="card kpi"><div class="label">Total biaya maintenance</div><div class="value">${rupiah(totalCost)}</div></div>
      </div>
      ${table(['Barang', '#Unit', 'Keterangan', 'Mulai', 'Selesai', '#Biaya', 'Status', ''],
        list.map((m) => `<tr><td>${esc(m.equipment_name)}</td><td class="num">${m.qty}</td><td>${esc(m.description)}</td>
          <td>${fmtDate(m.start_date)}</td><td>${fmtDate(m.end_date)}</td><td class="num">${rupiah(m.cost)}</td>
          <td>${m.status === 'proses' ? '<span class="badge warn">Proses</span>' : '<span class="badge ok">Selesai</span>'}</td>
          <td class="actions">${m.status === 'proses' ? `<button class="btn btn-sm" data-done="${m.id}">Tandai selesai</button>` : ''}<button class="btn btn-sm btn-ghost" data-del="${m.id}">🗑</button></td></tr>`), 'Belum ada catatan maintenance.')}`;
    $$('[data-done]', view).forEach((b) => (b.onclick = async () => {
      const cost = prompt('Biaya akhir (Rp)? Kosongkan jika tidak berubah.');
      if (cost === null) return;
      const body = { status: 'selesai' };
      if (cost.trim() !== '') body.cost = cost;
      await api('/admin/maintenance/' + b.dataset.done, { method: 'PUT', body });
      toast('Barang kembali tersedia');
      reload();
    }));
    $$('[data-del]', view).forEach((b) => (b.onclick = async () => {
      if (!confirm('Hapus catatan ini?')) return;
      await api('/admin/maintenance/' + b.dataset.del, { method: 'DELETE' });
      reload();
    }));
  };

  /* =========================================================
   *  PELANGGAN
   * ========================================================= */
  let custQ = '';
  VIEWS.customers = async () => {
    $('#viewActions').innerHTML = '<button class="btn" id="addCust">+ Tambah pelanggan</button>';
    $('#addCust').onclick = () => customerForm();
    const list = await api('/admin/customers?' + new URLSearchParams({ q: custQ }));
    view.innerHTML = `
      <div class="toolbar"><input id="cQ" type="search" placeholder="Cari nama / email / HP" value="${esc(custQ)}" /><span class="muted small">${list.length} pelanggan</span></div>
      ${table(['Nama', 'Kontak', 'No. KTP', 'Alamat', '#Booking', '#Total bayar', '#Tunggakan', 'Terdaftar', ''],
        list.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.notes ? `<div class="small muted">${esc(c.notes)}</div>` : ''}</td>
          <td>${esc(c.phone || '')}<div class="small muted">${c.email.endsWith('@lokal') ? '—' : esc(c.email)}</div></td>
          <td>${esc(c.id_number || '-')}</td><td class="small">${esc(c.address || '-')}</td>
          <td class="num">${c.booking_count}</td><td class="num">${rupiah(c.total_paid)}</td>
          <td class="num">${c.balance ? `<b style="color:var(--danger)">${rupiah(c.balance)}</b>` : '-'}</td>
          <td>${fmtDate(c.created_at)}</td>
          <td class="actions"><button class="btn btn-sm btn-ghost" data-view-c="${c.id}">Riwayat</button><button class="btn btn-sm btn-ghost" data-edit="${c.id}">Edit</button></td></tr>`), 'Belum ada pelanggan.')}`;
    let t;
    $('#cQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { custQ = e.target.value; reload(); }, 350); };
    $$('[data-edit]', view).forEach((b) => (b.onclick = () => customerForm(list.find((c) => c.id === +b.dataset.edit))));
    $$('[data-view-c]', view).forEach((b) => (b.onclick = async () => {
      const c = await api('/admin/customers/' + b.dataset.viewC);
      const body = openModal(`Riwayat ${c.name}`, table(['Kode', 'Tanggal', 'Status', '#Total', 'Bayar'],
        c.bookings.map((x) => `<tr><td><a href="#" data-booking="${x.id}">${esc(x.code)}</a></td><td>${fmtDate(x.start_date)} – ${fmtDate(x.end_date)}</td><td><span class="badge ${x.status}">${STATUS_LABEL[x.status]}</span></td><td class="num">${rupiah(x.total)}</td><td><span class="badge ${x.payment_status}">${PAY_LABEL[x.payment_status]}</span></td></tr>`), 'Belum pernah menyewa.'), { wide: true });
      $$('[data-booking]', body).forEach((a) => (a.onclick = (e) => { e.preventDefault(); bookingDetail(+a.dataset.booking); }));
    }));
  };

  function customerForm(c = null) {
    const body = openModal(c ? 'Edit pelanggan' : 'Tambah pelanggan', `
      <div id="cAlert"></div>
      <form id="cForm">
        <div class="grid-2">
          <div class="field"><label>Nama *</label><input name="name" required value="${esc(c?.name || '')}" /></div>
          <div class="field"><label>No. HP / WA *</label><input name="phone" required value="${esc(c?.phone || '')}" /></div>
        </div>
        <div class="grid-2">
          ${c ? `<div class="field"><label>Email</label><input disabled value="${esc(c.email)}" /></div>` : '<div class="field"><label>Email (opsional)</label><input name="email" type="email" /></div>'}
          <div class="field"><label>No. KTP</label><input name="id_number" value="${esc(c?.id_number || '')}" /></div>
        </div>
        <div class="field"><label>Alamat</label><textarea name="address" rows="2">${esc(c?.address || '')}</textarea></div>
        <div class="field"><label>Catatan internal</label><input name="notes" value="${esc(c?.notes || '')}" placeholder="Mis. pelanggan langganan, pernah telat" /></div>
        <button class="btn btn-block">Simpan</button>
      </form>`);
    $('#cForm', body).onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api(c ? '/admin/customers/' + c.id : '/admin/customers', { method: c ? 'PUT' : 'POST', body: formData(ev.target) });
        toast('Data pelanggan tersimpan');
        reload();
      } catch (err) { $('#cAlert').innerHTML = errBox(err.message); }
    };
  }

  /* =========================================================
   *  ULASAN & PESAN
   * ========================================================= */
  VIEWS.reviews = async () => {
    const [reviews, messages] = await Promise.all([api('/admin/reviews'), api('/admin/messages')]);
    view.innerHTML = `
      <h3>Pesan dari form kontak</h3>
      ${table(['Waktu', 'Nama', 'Kontak', 'Pesan', ''], messages.map((m) => `<tr style="${m.handled ? 'opacity:.55' : ''}"><td>${fmtDateTime(m.created_at)}</td><td>${esc(m.name)}</td><td>${esc(m.contact)}</td><td>${esc(m.message)}</td>
        <td><button class="btn btn-sm ${m.handled ? 'btn-ghost' : ''}" data-msg="${m.id}" data-h="${m.handled ? 0 : 1}">${m.handled ? 'Tandai belum' : 'Sudah dibalas'}</button></td></tr>`), 'Belum ada pesan.')}
      <h3 style="margin-top:24px">Ulasan pelanggan</h3>
      ${table(['Waktu', 'Nama', 'Rating', 'Komentar', 'Status', ''], reviews.map((r) => `<tr><td>${fmtDate(r.created_at)}</td><td>${esc(r.name)}</td><td style="color:var(--accent)">${'★'.repeat(r.rating)}</td><td>${esc(r.comment)}</td>
        <td>${r.approved ? '<span class="badge ok">Tampil</span>' : '<span class="badge warn">Menunggu</span>'}</td>
        <td class="actions"><button class="btn btn-sm ${r.approved ? 'btn-ghost' : ''}" data-rev="${r.id}" data-a="${r.approved ? 0 : 1}">${r.approved ? 'Sembunyikan' : 'Tampilkan'}</button><button class="btn btn-sm btn-ghost" data-rdel="${r.id}">🗑</button></td></tr>`), 'Belum ada ulasan.')}`;
    $$('[data-msg]', view).forEach((b) => (b.onclick = async () => { await api('/admin/messages/' + b.dataset.msg, { method: 'PUT', body: { handled: b.dataset.h === '1' } }); reload(); }));
    $$('[data-rev]', view).forEach((b) => (b.onclick = async () => { await api('/admin/reviews/' + b.dataset.rev, { method: 'PUT', body: { approved: b.dataset.a === '1' } }); reload(); }));
    $$('[data-rdel]', view).forEach((b) => (b.onclick = async () => { if (confirm('Hapus ulasan?')) { await api('/admin/reviews/' + b.dataset.rdel, { method: 'DELETE' }); reload(); } }));
  };

  /* =========================================================
   *  PENGATURAN
   * ========================================================= */
  VIEWS.settings = async () => {
    const s = await api('/admin/settings');
    const f = (k, label, type = 'text', hint = '') => `<div class="field"><label>${label}</label>${type === 'textarea' ? `<textarea name="${k}" rows="3">${esc(s[k])}</textarea>` : `<input name="${k}" type="${type}" value="${esc(s[k])}" />`}${hint ? `<div class="small muted">${hint}</div>` : ''}</div>`;
    view.innerHTML = `<form class="card pad" id="setForm" style="max-width:820px">
      <h3>Profil usaha</h3>
      <div class="grid-2">${f('business_name', 'Nama usaha')}${f('instagram', 'Instagram (tanpa @)')}</div>
      ${f('tagline', 'Tagline')}${f('about', 'Tentang usaha', 'textarea')}
      <h3 style="margin-top:10px">Kontak & lokasi</h3>
      ${f('address', 'Alamat lengkap')}
      ${f('maps_query', 'Lokasi Google Maps', 'text', 'Nama tempat atau koordinat, mis. "-6.1754,106.8272"')}
      <div class="grid-2">${f('phone', 'No. telepon')}${f('whatsapp', 'No. WhatsApp', 'text', 'Format internasional tanpa +, mis. 6281234567890')}</div>
      <div class="grid-2">${f('email', 'Email', 'email')}${f('hours', 'Jam operasional')}</div>
      <h3 style="margin-top:10px">Aturan sewa</h3>
      ${f('bank_info', 'Info rekening pembayaran')}
      <div class="grid-2">${f('late_fee_percent', 'Denda telat (% tarif harian per hari)', 'number')}${f('min_days', 'Minimal hari sewa', 'number')}</div>
      <button class="btn">Simpan pengaturan</button>
    </form>`;
    $('#setForm').onsubmit = async (e) => {
      e.preventDefault();
      const r = await api('/admin/settings', { method: 'PUT', body: formData(e.target) });
      $('#bizName').textContent = r.business_name;
      toast('Pengaturan tersimpan');
    };
  };

  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== current && VIEWS[h]) go(h); });
  boot();
})();
