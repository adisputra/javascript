/* Halaman pelanggan */
(function () {
  const { api, store, TOKEN_KEY, rupiah, esc, todayStr, addDays, daysBetween, fmtDate, toast, STATUS_LABEL, PAY_LABEL } = window.RK;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const state = {
    info: {},
    items: [],
    category: '',
    q: '',
    start: store.get('rk_start') || todayStr(1),
    end: store.get('rk_end') || todayStr(3),
    cart: JSON.parse(store.get('rk_cart') || '{}'), // { equipmentId: qty }
    user: null,
    chat: [],
  };
  if (state.start < todayStr()) { state.start = todayStr(1); state.end = todayStr(3); }

  /* ---------- Info usaha ---------- */
  async function loadInfo() {
    const info = (state.info = await api('/info'));
    $$('[data-info]').forEach((el) => { if (info[el.dataset.info]) el.textContent = info[el.dataset.info]; });
    document.title = `${info.business_name} — Sewa Alat Kamping`;
    const wa = `https://wa.me/${info.whatsapp}`;
    $('#waLink').href = wa;
    $('#waFab').href = wa;
    $('#mailLink').href = `mailto:${info.email}`;
    $('#igLink').href = `https://instagram.com/${info.instagram}`;
    $('#igLink').textContent = '@' + info.instagram;
    $('#map').src = `https://www.google.com/maps?q=${encodeURIComponent(info.maps_query || info.address)}&output=embed`;
    $('#statRating').textContent = info.rating_count ? `${info.rating_avg} ★` : '–';
    $('#ratingSummary').textContent = info.rating_count
      ? `Rata-rata ${info.rating_avg} dari 5 (${info.rating_count} ulasan).`
      : 'Jadilah yang pertama memberi ulasan.';
  }

  /* ---------- Katalog ---------- */
  function syncDates() {
    store.set('rk_start', state.start);
    store.set('rk_end', state.end);
    for (const [s, e] of [['#heroStart', '#heroEnd'], ['#cartStart', '#cartEnd']]) {
      $(s).value = state.start; $(s).min = todayStr();
      $(e).value = state.end; $(e).min = addDays(state.start, 1);
    }
    const days = daysBetween(state.start, state.end);
    $('#dateNote').innerHTML = `📅 Stok untuk <b>${fmtDate(state.start)}</b> – <b>${fmtDate(state.end)}</b> (${days} hari)
      <button class="btn btn-sm btn-ghost" id="changeDate" style="margin-left:auto">Ubah tanggal</button>`;
    $('#changeDate').onclick = () => { $('#heroStart').focus(); window.scrollTo({ top: 0 }); };
  }

  function setDates(start, end) {
    if (!start) return;
    if (start < todayStr()) start = todayStr();
    if (!end || end <= start) end = addDays(start, 1);
    state.start = start; state.end = end;
    syncDates();
    loadCatalog();
  }

  async function loadCatalog() {
    const qs = new URLSearchParams({ start: state.start, end: state.end });
    try {
      state.items = await api('/equipment?' + qs);
    } catch (e) {
      $('#products').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    $('#statItems').textContent = state.items.length;
    renderFilters();
    renderProducts();
    renderCart();
  }

  function renderFilters() {
    const cats = [...new Set(state.items.map((i) => i.category))];
    $('#filters').innerHTML = ['', ...cats]
      .map((c) => `<button class="chip ${state.category === c ? 'active' : ''}" data-cat="${esc(c)}">${c ? esc(c) : 'Semua'}</button>`)
      .join('');
    $$('#filters .chip').forEach((b) => (b.onclick = () => { state.category = b.dataset.cat; renderFilters(); renderProducts(); }));
  }

  function renderProducts() {
    const q = state.q.toLowerCase();
    const list = state.items.filter(
      (i) => (!state.category || i.category === state.category) && (!q || (i.name + ' ' + (i.description || '')).toLowerCase().includes(q))
    );
    if (!list.length) { $('#products').innerHTML = '<div class="empty">Tidak ada barang yang cocok.</div>'; return; }
    $('#products').innerHTML = list
      .map((i) => {
        const inCart = state.cart[i.id] || 0;
        const stockBadge = i.available === 0
          ? '<span class="badge bad">Habis</span>'
          : i.available <= 2 ? `<span class="badge warn">Sisa ${i.available}</span>` : `<span class="badge ok">Tersedia ${i.available}</span>`;
        return `<article class="card product">
          <div class="product-img"><img src="${esc(i.image_url || '/img/tenda.svg')}" alt="${esc(i.name)}" loading="lazy" />${stockBadge}</div>
          <div class="product-body">
            <span class="muted small">${esc(i.category)}</span>
            <h3>${esc(i.name)}</h3>
            <p class="desc">${esc(i.description || '')}</p>
            <div class="row" style="justify-content:space-between">
              <div class="price">${rupiah(i.price_per_day)} <small>/hari</small></div>
              <span class="small muted">${i.available}/${i.stock_total} unit</span>
            </div>
            ${inCart
              ? `<div class="row" style="justify-content:space-between"><div class="qty"><button data-dec="${i.id}">−</button><span>${inCart}</span><button data-inc="${i.id}">+</button></div><button class="btn btn-sm btn-ghost" data-open-cart>Lihat keranjang</button></div>`
              : `<button class="btn btn-block" data-add="${i.id}" ${i.available ? '' : 'disabled'}>${i.available ? 'Sewa' : 'Stok habis'}</button>`}
          </div>
        </article>`;
      })
      .join('');
  }

  function changeQty(id, delta) {
    const item = state.items.find((i) => i.id === id);
    const cur = state.cart[id] || 0;
    let next = cur + delta;
    if (item && next > item.available) { toast(`Stok ${item.name} hanya ${item.available} untuk tanggal ini.`); next = item.available; }
    if (next <= 0) delete state.cart[id]; else state.cart[id] = next;
    store.set('rk_cart', JSON.stringify(state.cart));
    renderProducts();
    renderCart();
  }

  $('#products').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.add) { changeQty(+t.dataset.add, 1); toast('Ditambahkan ke keranjang'); }
    if (t.dataset.inc) changeQty(+t.dataset.inc, 1);
    if (t.dataset.dec) changeQty(+t.dataset.dec, -1);
    if (t.hasAttribute('data-open-cart')) openDrawer();
  });

  /* ---------- Keranjang & form sewa ---------- */
  function cartLines() {
    return Object.entries(state.cart)
      .map(([id, qty]) => ({ item: state.items.find((i) => i.id === +id), qty }))
      .filter((l) => l.item);
  }

  function renderCart() {
    const lines = cartLines();
    const count = lines.reduce((s, l) => s + l.qty, 0);
    $('#cartCount').textContent = count;
    $('#cartCount').classList.toggle('hidden', !count);
    const days = daysBetween(state.start, state.end);
    if (!lines.length) {
      $('#cartItems').innerHTML = '<div class="empty">Keranjang masih kosong.<br/>Pilih barang di katalog.</div>';
      $('#cartSummary').innerHTML = '';
      $('#checkoutBtn').disabled = true;
      return;
    }
    let total = 0;
    let problem = false;
    $('#cartItems').innerHTML = lines
      .map(({ item, qty }) => {
        const line = item.price_per_day * qty * days;
        total += line;
        const over = qty > item.available;
        if (over) problem = true;
        return `<div class="cart-item">
          <img src="${esc(item.image_url || '/img/tenda.svg')}" alt="" />
          <div><b>${esc(item.name)}</b><div class="small muted">${rupiah(item.price_per_day)} × ${qty} × ${days} hari</div>
            ${over ? `<div class="small" style="color:var(--danger)">Hanya tersedia ${item.available}</div>` : ''}
            <div class="qty" style="margin-top:6px"><button data-dec="${item.id}">−</button><span>${qty}</span><button data-inc="${item.id}">+</button></div></div>
          <b class="tnum">${rupiah(line)}</b>
        </div>`;
      })
      .join('');
    $('#cartSummary').innerHTML = `<div><span class="muted">Durasi</span><span>${days} hari</span></div>
      <div class="total"><span>Total</span><span class="tnum">${rupiah(total)}</span></div>`;
    $('#checkoutBtn').disabled = problem;
    $('#checkoutBtn').textContent = state.user ? 'Kirim pesanan' : 'Masuk untuk memesan';
  }

  $('#cartItems').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.inc) changeQty(+t.dataset.inc, 1);
    if (t.dataset.dec) changeQty(+t.dataset.dec, -1);
  });

  function openDrawer() { $('#cartDrawer').classList.add('open'); $('#overlay').classList.add('open'); renderCart(); }
  function closeAll() {
    $('#cartDrawer').classList.remove('open');
    $('#overlay').classList.remove('open');
    $$('.modal').forEach((m) => m.classList.remove('open'));
  }
  $('#cartBtn').onclick = openDrawer;
  $('#overlay').onclick = closeAll;
  $$('[data-close]').forEach((b) => (b.onclick = closeAll));
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeAll(); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  $('#cartStart').onchange = () => setDates($('#cartStart').value, $('#cartEnd').value);
  $('#cartEnd').onchange = () => setDates($('#cartStart').value, $('#cartEnd').value);

  $('#checkoutBtn').onclick = async () => {
    if (!state.user) { openModal('authModal'); return; }
    const btn = $('#checkoutBtn');
    btn.disabled = true;
    $('#cartAlert').innerHTML = '';
    try {
      const b = await api('/bookings', {
        method: 'POST',
        body: {
          start_date: state.start,
          end_date: state.end,
          items: cartLines().map((l) => ({ equipment_id: l.item.id, qty: l.qty })),
          pickup_method: $('#pickup').value,
          notes: $('#notes').value,
        },
      });
      state.cart = {};
      store.set('rk_cart', '{}');
      $('#notes').value = '';
      closeAll();
      await loadCatalog();
      openMe();
      toast(`Pesanan ${b.code} terkirim! Admin akan segera mengonfirmasi.`);
    } catch (e) {
      $('#cartAlert').innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
      loadCatalog();
    } finally {
      btn.disabled = false;
    }
  };

  /* ---------- Akun ---------- */
  function openModal(id) { closeAll(); $('#' + id).classList.add('open'); }

  function setTabs(root, onChange) {
    $$('.tabs button', root).forEach((b) =>
      (b.onclick = () => {
        $$('.tabs button', root).forEach((x) => x.classList.toggle('active', x === b));
        onChange(b.dataset.tab);
      })
    );
  }
  setTabs($('#authModal'), (tab) => {
    $('#loginForm').classList.toggle('hidden', tab !== 'login');
    $('#registerForm').classList.toggle('hidden', tab !== 'register');
    $('#authAlert').innerHTML = '';
  });
  setTabs($('#meModal'), (tab) => {
    $('#myBookings').classList.toggle('hidden', tab !== 'mybookings');
    $('#profileForm').classList.toggle('hidden', tab !== 'profile');
  });

  function setUser(user, token) {
    state.user = user;
    if (token !== undefined) store.set(TOKEN_KEY, token);
    $('#accountLabel').textContent = user ? user.name.split(' ')[0] : 'Masuk';
    renderCart();
  }

  async function handleAuth(form, path) {
    $('#authAlert').innerHTML = '';
    try {
      const data = await api(path, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      setUser(data.user, data.token);
      form.reset();
      closeAll();
      toast(`Halo, ${data.user.name}!`);
      if (cartLines().length) openDrawer();
    } catch (e) {
      $('#authAlert').innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
    }
  }
  $('#loginForm').onsubmit = (e) => { e.preventDefault(); handleAuth(e.target, '/auth/login'); };
  $('#registerForm').onsubmit = (e) => { e.preventDefault(); handleAuth(e.target, '/auth/register'); };

  $('#accountBtn').onclick = () => (state.user ? openMe() : openModal('authModal'));

  async function openMe() {
    openModal('meModal');
    $('#meTitle').textContent = `Halo, ${state.user.name}`;
    const f = $('#profileForm');
    for (const k of ['name', 'phone', 'email', 'id_number', 'address']) f.elements[k].value = state.user[k] || '';
    $('#myBookings').innerHTML = '<div class="empty">Memuat…</div>';
    try {
      const list = await api('/bookings');
      $('#myBookings').innerHTML = list.length
        ? list.map(bookingCard).join('')
        : '<div class="empty">Belum ada pesanan. Yuk pilih perlengkapan di katalog!</div>';
    } catch (e) {
      $('#myBookings').innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
    }
  }

  function bookingCard(b) {
    return `<div class="card booking-card">
      <div class="row"><b>${esc(b.code)}</b><span class="badge ${b.status}">${STATUS_LABEL[b.status]}</span></div>
      <div class="small muted">${fmtDate(b.start_date)} – ${fmtDate(b.end_date)} • ${b.days} hari • ${b.pickup_method === 'antar' ? 'Diantar' : 'Ambil di toko'}</div>
      <ul>${b.items.map((i) => `<li>${esc(i.name)} × ${i.qty}</li>`).join('')}</ul>
      <div class="row">
        <span>Total <b>${rupiah(b.total)}</b>${b.late_fee ? ` <span class="small muted">(termasuk denda ${rupiah(b.late_fee)})</span>` : ''}</span>
        <span class="badge ${b.payment_status}">${PAY_LABEL[b.payment_status]}${b.balance && b.status !== 'dibatalkan' ? ' • sisa ' + rupiah(b.balance) : ''}</span>
      </div>
      ${b.balance && b.status !== 'dibatalkan' ? `<div class="small muted" style="margin-top:6px">Transfer ke ${esc(state.info.bank_info)}, lalu kirim bukti via <a target="_blank" rel="noopener" href="https://wa.me/${esc(state.info.whatsapp)}?text=${encodeURIComponent('Halo, saya kirim bukti bayar untuk ' + b.code)}">WhatsApp</a>.</div>` : ''}
      ${['menunggu', 'dikonfirmasi'].includes(b.status) ? `<div style="margin-top:10px"><button class="btn btn-sm btn-ghost" data-cancel="${b.id}">Batalkan pesanan</button></div>` : ''}
    </div>`;
  }

  $('#myBookings').addEventListener('click', async (e) => {
    const id = e.target.dataset.cancel;
    if (!id || !confirm('Batalkan pesanan ini?')) return;
    try { await api(`/bookings/${id}/cancel`, { method: 'POST' }); toast('Pesanan dibatalkan'); openMe(); loadCatalog(); }
    catch (err) { toast(err.message); }
  });

  $('#profileForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    if (!body.new_password) { delete body.new_password; delete body.current_password; }
    try {
      const u = await api('/me', { method: 'PUT', body });
      setUser(u);
      e.target.elements.new_password.value = e.target.elements.current_password.value = '';
      $('#profileAlert').innerHTML = '<div class="alert ok">Data tersimpan.</div>';
    } catch (err) {
      $('#profileAlert').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
    }
  };

  $('#logoutBtn').onclick = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    setUser(null, null);
    closeAll();
    toast('Anda sudah keluar.');
  };

  /* ---------- Ulasan ---------- */
  async function loadReviews() {
    const list = await api('/reviews');
    $('#reviews').innerHTML = list.length
      ? list
          .map((r) => `<div class="card review"><div class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
            <p>“${esc(r.comment)}”</p><div class="small"><b>${esc(r.name)}</b> <span class="muted">• ${fmtDate(r.created_at)}</span></div></div>`)
          .join('')
      : '<div class="empty">Belum ada ulasan.</div>';
  }
  $('#writeReviewBtn').onclick = () => {
    if (!state.user) { toast('Masuk dulu untuk menulis ulasan.'); openModal('authModal'); return; }
    $('#reviewAlert').innerHTML = '';
    openModal('reviewModal');
  };
  $('#reviewForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/reviews', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      closeAll();
      toast(r.message);
    } catch (err) {
      $('#reviewAlert').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
    }
  };

  /* ---------- Kontak ---------- */
  $('#contactForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/contact', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      toast(r.message);
    } catch (err) { toast(err.message); }
  };

  /* ---------- Chatbot ---------- */
  function addMsg(text, who) {
    const el = document.createElement('div');
    el.className = 'msg ' + who;
    el.textContent = text;
    $('#chatLog').appendChild(el);
    $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
    return el;
  }
  async function sendChat(text) {
    text = text.trim();
    if (!text) return;
    addMsg(text, 'me');
    const typing = addMsg('Mengetik…', 'bot typing');
    try {
      const r = await api('/chat', { method: 'POST', body: { message: text, history: state.chat } });
      typing.remove();
      addMsg(r.reply, 'bot');
      state.chat.push({ role: 'user', content: text }, { role: 'assistant', content: r.reply });
      state.chat = state.chat.slice(-10);
    } catch (e) {
      typing.remove();
      addMsg('Maaf, koneksi bermasalah. Coba lagi atau hubungi WhatsApp kami.', 'bot');
    }
  }
  $('#chatFab').onclick = () => {
    const p = $('#chatPanel');
    p.classList.toggle('open');
    if (p.classList.contains('open')) {
      if (!$('#chatLog').children.length)
        addMsg(`Halo! 👋 Saya asisten ${state.info.business_name || ''}. Mau cek stok, harga, atau cara sewa?`, 'bot');
      $('#chatInput').focus();
    }
  };
  $('#chatClose').onclick = () => $('#chatPanel').classList.remove('open');
  $('#chatForm').onsubmit = (e) => { e.preventDefault(); const v = $('#chatInput').value; $('#chatInput').value = ''; sendChat(v); };
  $$('#chatQuick button').forEach((b) => (b.onclick = () => sendChat(b.textContent)));

  /* ---------- Lain-lain ---------- */
  $('#heroSearch').onsubmit = (e) => {
    e.preventDefault();
    setDates($('#heroStart').value, $('#heroEnd').value);
    $('#katalog').scrollIntoView();
  };
  $('#heroStart').onchange = () => { if ($('#heroEnd').value <= $('#heroStart').value) $('#heroEnd').value = addDays($('#heroStart').value, 1); $('#heroEnd').min = addDays($('#heroStart').value, 1); };
  $('#search').oninput = (e) => { state.q = e.target.value; renderProducts(); };
  $('#menuToggle').onclick = () => $('#navLinks').classList.toggle('open');
  $$('#navLinks a').forEach((a) => (a.onclick = () => $('#navLinks').classList.remove('open')));
  $('#year').textContent = new Date().getFullYear();

  async function init() {
    syncDates();
    if (store.get(TOKEN_KEY)) {
      try { setUser(await api('/me')); } catch { setUser(null, null); }
    }
    await Promise.all([loadInfo().catch(() => {}), loadCatalog(), loadReviews().catch(() => {})]);
  }
  init();
})();
