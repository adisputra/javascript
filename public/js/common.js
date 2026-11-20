/* Utilitas bersama untuk halaman pelanggan & admin. */
(function () {
  const TOKEN_KEY = window.TOKEN_KEY || 'rk_token';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  async function api(path, { method = 'GET', body, form } = {}) {
    const headers = {};
    const token = store.get(TOKEN_KEY);
    if (token) headers.Authorization = 'Bearer ' + token;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch('/api' + path, { method, headers, body: payload });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Terjadi kesalahan (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function todayStr(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d - off).toISOString().slice(0, 10);
  }
  function addDays(s, n) {
    const d = new Date(s + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.max(1, Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000));
  }
  const fmtDate = (s) => {
    if (!s) return '-';
    const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtDateTime = (s) => (s ? fmtDate(s) + ' ' + String(s).slice(11, 16) : '-');

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return alert(msg);
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  const STATUS_LABEL = {
    menunggu: 'Menunggu konfirmasi',
    dikonfirmasi: 'Dikonfirmasi',
    diambil: 'Sedang disewa',
    dikembalikan: 'Selesai',
    dibatalkan: 'Dibatalkan',
  };
  const PAY_LABEL = { lunas: 'Lunas', dp: 'DP / sebagian', belum: 'Belum bayar', batal: '-' };

  window.RK = { api, store, TOKEN_KEY, rupiah, esc, todayStr, addDays, daysBetween, fmtDate, fmtDateTime, toast, STATUS_LABEL, PAY_LABEL };
})();
