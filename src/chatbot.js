// Chatbot layanan pelanggan.
// - Tanpa API key: menjawab dengan aturan (FAQ + data stok & harga langsung dari database).
// - Dengan ANTHROPIC_API_KEY: memakai Claude, diberi konteks katalog & info usaha terbaru.
const { all } = require('./db');
const { getSettings, equipmentWithAvailability, today } = require('./services');

const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');

function catalog() {
  return all('SELECT * FROM equipment WHERE active = 1 ORDER BY category, name').map((e) =>
    equipmentWithAvailability(e)
  );
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const has = (text, words) => words.some((w) => text.includes(w));

const STOPWORDS = new Set(
  'ada apa yang untuk mau dong kak min gan sewa harga berapa stok tersedia ready bisa saya aku kami ini itu dan atau per hari brp'.split(' ')
);

/** Cari barang yang paling cocok dengan pertanyaan (skor = jumlah kata yang cocok). */
function findProducts(text, items) {
  const tokens = text.split(' ').filter((t) => (t.length >= 3 || /^\d+$/.test(t)) && !STOPWORDS.has(t));
  if (!tokens.length) return [];
  const scored = items
    .map((e) => {
      const words = norm(`${e.name} ${e.category}`).split(' ');
      const score = tokens.filter((t) => words.some((w) => (/^\d+$/.test(t) ? w === t : w.startsWith(t)))).length;
      return { e, score };
    })
    .filter((x) => x.score > 0);
  const best = Math.max(0, ...scored.map((x) => x.score));
  return scored.filter((x) => x.score === best).map((x) => x.e);
}

function ruleBasedReply(message) {
  const s = getSettings();
  const text = norm(message);
  const items = catalog();
  const wa = `https://wa.me/${s.whatsapp}`;

  if (!text || has(text, ['halo', 'hai', 'hallo', 'pagi', 'siang', 'sore', 'malam', 'assalamualaikum']) && text.length < 25) {
    return `Halo! 👋 Saya asisten ${s.business_name}. Saya bisa bantu cek stok & harga, cara sewa, pembayaran, lokasi, dan jam buka. Mau tanya apa?`;
  }

  const products = findProducts(text, items);
  if (products.length && !has(text, ['cara', 'bayar', 'lokasi', 'alamat'])) {
    const lines = products
      .slice(0, 6)
      .map((e) => `• ${e.name} — ${rupiah(e.price_per_day)}/hari, tersedia ${e.available} dari ${e.stock_total} unit`);
    return `Ini yang saya temukan (stok hari ini):\n${lines.join('\n')}\n\nUntuk tanggal tertentu, pilih tanggal di halaman Katalog lalu klik "Sewa".`;
  }

  if (has(text, ['harga', 'tarif', 'biaya', 'berapa', 'murah', 'daftar', 'katalog', 'list', 'stok', 'tersedia', 'ready', 'ada apa'])) {
    const lines = items
      .slice(0, 12)
      .map((e) => `• ${e.name} — ${rupiah(e.price_per_day)}/hari (tersedia ${e.available})`);
    return `Daftar alat & harga sewa per hari:\n${lines.join('\n')}${items.length > 12 ? '\n…dan lainnya di halaman Katalog.' : ''}`;
  }

  if (has(text, ['cara', 'gimana', 'bagaimana', 'prosedur', 'booking', 'pesan', 'sewa', 'syarat'])) {
    return [
      'Cara sewa:',
      '1. Daftar / login akun (isi nama, no. HP, dan No. KTP).',
      '2. Pilih barang di Katalog, tentukan tanggal ambil & kembali.',
      '3. Kirim form sewa — status awal "menunggu konfirmasi".',
      '4. Admin mengonfirmasi, lalu lakukan pembayaran (DP / lunas).',
      '5. Ambil barang di toko dengan membawa KTP asli sebagai jaminan.',
      `Keterlambatan dikenakan denda ${s.late_fee_percent}% dari tarif harian per hari.`,
    ].join('\n');
  }

  if (has(text, ['bayar', 'pembayaran', 'transfer', 'rekening', 'dp', 'lunas', 'qris'])) {
    return `Pembayaran bisa tunai di toko atau transfer ke ${s.bank_info}. DP diperbolehkan, pelunasan paling lambat saat pengambilan barang. Kirim bukti transfer via WhatsApp: ${wa}`;
  }

  if (has(text, ['lokasi', 'alamat', 'dimana', 'di mana', 'maps', 'peta', 'toko'])) {
    return `Lokasi kami: ${s.address}. Lihat peta di bagian "Lokasi" halaman ini.`;
  }

  if (has(text, ['jam', 'buka', 'tutup', 'operasional', 'libur'])) {
    return `Jam operasional: ${s.hours}.`;
  }

  if (has(text, ['kontak', 'hubungi', 'wa', 'whatsapp', 'telp', 'telepon', 'nomor', 'admin', 'cs'])) {
    return `Hubungi kami: WhatsApp ${wa} • Telp ${s.phone} • Email ${s.email}`;
  }

  if (has(text, ['telat', 'terlambat', 'denda', 'rusak', 'hilang'])) {
    return `Keterlambatan dikenakan denda ${s.late_fee_percent}% dari tarif harian per hari. Kerusakan/kehilangan diganti sesuai kesepakatan dengan admin.`;
  }

  if (has(text, ['antar', 'kirim', 'delivery', 'ongkir'])) {
    return `Bisa diantar untuk area tertentu (ongkir menyesuaikan). Pilih metode "Diantar" di form sewa, admin akan menghubungi Anda. Info: ${wa}`;
  }

  return `Maaf, saya belum paham pertanyaannya. Coba tanya soal harga, stok (mis. "tenda 4 orang"), cara sewa, pembayaran, atau lokasi. Atau chat admin langsung: ${wa}`;
}

let anthropicClient = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    const Ctor = Anthropic.default || Anthropic;
    anthropicClient = new Ctor();
  }
  return anthropicClient;
}

function systemPrompt() {
  const s = getSettings();
  const list = catalog()
    .map((e) => `- ${e.name} (${e.category}): ${rupiah(e.price_per_day)}/hari, tersedia hari ini ${e.available}/${e.stock_total}`)
    .join('\n');
  return `Kamu adalah asisten layanan pelanggan untuk usaha sewa peralatan kamping "${s.business_name}".
Jawab dalam Bahasa Indonesia yang ramah, singkat (maksimal ~6 kalimat), tanpa markdown tebal/heading.
Hanya gunakan informasi di bawah. Jika tidak tahu atau ditanya hal di luar layanan, arahkan ke WhatsApp admin.
Jangan menjanjikan stok untuk tanggal tertentu — sarankan cek tanggal di Katalog karena stok di bawah adalah stok hari ini (${today()}).

INFO USAHA
Alamat: ${s.address}
Jam buka: ${s.hours}
Telepon: ${s.phone} | WhatsApp: https://wa.me/${s.whatsapp} | Email: ${s.email}
Pembayaran: tunai di toko atau transfer ke ${s.bank_info}. DP boleh, lunas paling lambat saat pengambilan.
Denda telat: ${s.late_fee_percent}% tarif harian per hari keterlambatan.
Cara sewa: daftar/login → pilih barang & tanggal di Katalog → kirim form sewa → admin konfirmasi → bayar → ambil barang dengan KTP asli.

KATALOG
${list}`;
}

/**
 * history: [{ role: 'user'|'assistant', content: string }] (opsional, maks 10 terakhir)
 */
async function reply(message, history = []) {
  const client = getClient();
  if (!client) return { reply: ruleBasedReply(message), source: 'rules' };

  const msgs = [];
  for (const h of (Array.isArray(history) ? history : []).slice(-10)) {
    if ((h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim()) {
      msgs.push({ role: h.role, content: h.content.slice(0, 2000) });
    }
  }
  // percakapan harus diawali user & bergantian
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  const clean = [];
  for (const m of msgs) {
    if (clean.length && clean[clean.length - 1].role === m.role) clean[clean.length - 1] = m;
    else clean.push(m);
  }
  if (clean.length && clean[clean.length - 1].role === 'user') clean.pop();
  clean.push({ role: 'user', content: String(message).slice(0, 2000) });

  try {
    const response = await client.beta.messages.create({
      model: process.env.CHATBOT_MODEL || 'claude-opus-5-5',
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: systemPrompt(),
      messages: clean,
    });
    if (response.stop_reason === 'refusal') return { reply: ruleBasedReply(message), source: 'rules' };
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return { reply: text || ruleBasedReply(message), source: text ? 'ai' : 'rules' };
  } catch (err) {
    console.error('[chatbot] Claude API error, pakai jawaban otomatis:', err?.status || '', err?.message);
    return { reply: ruleBasedReply(message), source: 'rules' };
  }
}

module.exports = { reply, ruleBasedReply };
