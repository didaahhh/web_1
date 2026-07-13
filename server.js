const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { db, initDatabase } = require('./database');
const {
  hitungUmurBulan,
  formatUmur,
  hitungStatusStunting,
  hitungStatusBB,
  formatTanggal,
} = require('./utils');

initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: 'posyandu-candiareng-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.role = req.session.role || null;
  next();
});

function requireIbu(req, res, next) {
  if (req.session.role === 'ibu' && req.session.balitaId) return next();
  res.redirect('/login');
}

function requireKader(req, res, next) {
  if (req.session.role === 'kader') return next();
  res.redirect('/kader/login');
}

function getBalitaDetail(balitaId) {
  const balita = db
    .prepare(
      `SELECT b.*, o.nama as nama_ibu, o.nik as nik_ibu, o.no_hp, o.alamat
       FROM balita b JOIN orang_tua o ON b.orang_tua_id = o.id WHERE b.id = ?`
    )
    .get(balitaId);
  if (!balita) return null;

  const kunjungan = db
    .prepare('SELECT * FROM kunjungan WHERE balita_id = ? ORDER BY tanggal ASC')
    .all(balitaId);
  const imunisasi = db
    .prepare('SELECT * FROM imunisasi WHERE balita_id = ? ORDER BY tanggal DESC')
    .all(balitaId);
  const vitamin = db
    .prepare('SELECT * FROM vitamin WHERE balita_id = ? ORDER BY tanggal DESC')
    .all(balitaId);

  const umurBulan = hitungUmurBulan(balita.tanggal_lahir);
  const terakhir = kunjungan[kunjungan.length - 1];

  let stunting = null;
  let bbStatus = null;
  if (terakhir) {
    stunting = hitungStatusStunting(terakhir.tinggi_badan, hitungUmurBulan(balita.tanggal_lahir, terakhir.tanggal), balita.jenis_kelamin);
    bbStatus = hitungStatusBB(terakhir.berat_badan, hitungUmurBulan(balita.tanggal_lahir, terakhir.tanggal), balita.jenis_kelamin);
  }

  const kunjunganEnriched = kunjungan.map((k) => {
    const umur = hitungUmurBulan(balita.tanggal_lahir, k.tanggal);
    const st = hitungStatusStunting(k.tinggi_badan, umur, balita.jenis_kelamin);
    const bb = hitungStatusBB(k.berat_badan, umur, balita.jenis_kelamin);
    return { ...k, umurBulan: umur, stunting: st, bbStatus: bb };
  });

  return {
    balita,
    kunjungan: kunjunganEnriched,
    imunisasi,
    vitamin,
    umurBulan,
    umurText: formatUmur(umurBulan),
    stunting,
    bbStatus,
    terakhir,
  };
}

// ─── Routes: Umum ───────────────────────────────────────────

app.get('/', (req, res) => {
  if (req.session.role === 'ibu') return res.redirect('/dashboard');
  if (req.session.role === 'kader') return res.redirect('/kader/dashboard');
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session.role === 'ibu') return res.redirect('/dashboard');
  res.render('login', { error: null, tab: req.query.tab || 'nik' });
});

app.post('/login/nik', (req, res) => {
  const { nik, password } = req.body;
  const ortu = db.prepare('SELECT * FROM orang_tua WHERE nik = ?').get(nik?.trim());
  if (!ortu || !bcrypt.compareSync(password, ortu.password)) {
    return res.render('login', { error: 'NIK atau password salah.', tab: 'nik' });
  }
  const anak = db.prepare('SELECT * FROM balita WHERE orang_tua_id = ? LIMIT 1').get(ortu.id);
  if (!anak) {
    return res.render('login', { error: 'Belum ada data balita terdaftar.', tab: 'nik' });
  }
  req.session.user = { id: ortu.id, nama: ortu.nama, nik: ortu.nik };
  req.session.role = 'ibu';
  req.session.balitaId = anak.id;
  req.session.ortuId = ortu.id;
  res.redirect('/dashboard');
});

app.post('/login/anak', (req, res) => {
  const { nama_anak, tanggal_lahir } = req.body;
  const balita = db
    .prepare('SELECT * FROM balita WHERE LOWER(nama) = LOWER(?) AND tanggal_lahir = ?')
    .get(nama_anak?.trim(), tanggal_lahir);
  if (!balita) {
    return res.render('login', { error: 'Nama anak atau tanggal lahir tidak ditemukan.', tab: 'anak' });
  }
  const ortu = db.prepare('SELECT * FROM orang_tua WHERE id = ?').get(balita.orang_tua_id);
  req.session.user = { id: ortu.id, nama: ortu.nama, nik: ortu.nik };
  req.session.role = 'ibu';
  req.session.balitaId = balita.id;
  req.session.ortuId = ortu.id;
  res.redirect('/dashboard');
});

app.get('/daftar', (req, res) => {
  if (req.session.role === 'ibu') return res.redirect('/dashboard');
  res.render('daftar', { error: null, form: {} });
});

app.post('/daftar', (req, res) => {
  const {
    nik, nama_ibu, password, password_confirm,
    no_hp, alamat, nama_anak, tanggal_lahir, jenis_kelamin, nik_balita,
  } = req.body;

  const form = { nik, nama_ibu, no_hp, alamat, nama_anak, tanggal_lahir, jenis_kelamin, nik_balita };

  if (!nik || nik.trim().length !== 16 || !/^\d+$/.test(nik.trim())) {
    return res.render('daftar', { error: 'NIK harus 16 digit angka.', form });
  }
  if (!password || password.length < 6) {
    return res.render('daftar', { error: 'Password minimal 6 karakter.', form });
  }
  if (password !== password_confirm) {
    return res.render('daftar', { error: 'Konfirmasi password tidak cocok.', form });
  }
  if (!nama_ibu?.trim() || !nama_anak?.trim() || !tanggal_lahir || !jenis_kelamin) {
    return res.render('daftar', { error: 'Lengkapi semua data yang wajib diisi.', form });
  }

  const existing = db.prepare('SELECT * FROM orang_tua WHERE nik = ?').get(nik.trim());
  if (existing) {
    return res.render('daftar', {
      error: 'NIK sudah terdaftar. Silakan login atau hubungi kader Posyandu.',
      form,
    });
  }

  try {
    const ortuId = db
      .prepare('INSERT INTO orang_tua (nik, nama, password, no_hp, alamat) VALUES (?, ?, ?, ?, ?)')
      .run(nik.trim(), nama_ibu.trim(), bcrypt.hashSync(password, 10), no_hp?.trim() || '', alamat?.trim() || '')
      .lastInsertRowid;

    const balitaId = db
      .prepare('INSERT INTO balita (orang_tua_id, nama, tanggal_lahir, jenis_kelamin, nik_balita) VALUES (?, ?, ?, ?, ?)')
      .run(ortuId, nama_anak.trim(), tanggal_lahir, jenis_kelamin, nik_balita?.trim() || null)
      .lastInsertRowid;

    req.session.user = { id: ortuId, nama: nama_ibu.trim(), nik: nik.trim() };
    req.session.role = 'ibu';
    req.session.balitaId = balitaId;
    req.session.ortuId = ortuId;
    res.redirect('/dashboard');
  } catch (err) {
    res.render('daftar', { error: 'Gagal mendaftar. Silakan coba lagi.', form });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ─── Routes: Dashboard Ibu ───────────────────────────────────

app.get('/dashboard', requireIbu, (req, res) => {
  const data = getBalitaDetail(req.session.balitaId);
  if (!data) return res.redirect('/login');

  const semuaAnak = db
    .prepare('SELECT id, nama, tanggal_lahir, jenis_kelamin FROM balita WHERE orang_tua_id = ?')
    .all(req.session.ortuId);

  res.render('dashboard-ibu', {
    ...data,
    semuaAnak,
    formatTanggal,
    activeBalitaId: req.session.balitaId,
  });
});

app.post('/dashboard/pilih-anak', requireIbu, (req, res) => {
  const { balita_id } = req.body;
  const balita = db
    .prepare('SELECT * FROM balita WHERE id = ? AND orang_tua_id = ?')
    .get(balita_id, req.session.ortuId);
  if (balita) req.session.balitaId = balita.id;
  res.redirect('/dashboard');
});

// ─── Routes: Kader ───────────────────────────────────────────

app.get('/kader/login', (req, res) => {
  if (req.session.role === 'kader') return res.redirect('/kader/dashboard');
  res.render('kader-login', { error: null });
});

app.post('/kader/login', (req, res) => {
  const { username, password } = req.body;
  const kader = db.prepare('SELECT * FROM kader WHERE username = ?').get(username?.trim());
  if (!kader || !bcrypt.compareSync(password, kader.password)) {
    return res.render('kader-login', { error: 'Username atau password salah.' });
  }
  req.session.user = { id: kader.id, nama: kader.nama, username: kader.username };
  req.session.role = 'kader';
  res.redirect('/kader/dashboard');
});

app.get('/kader/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/kader/login');
});

app.get('/kader/dashboard', requireKader, (req, res) => {
  const balitaList = db
    .prepare(
      `SELECT b.*, o.nama as nama_ibu, o.nik as nik_ibu,
        (SELECT COUNT(*) FROM kunjungan k WHERE k.balita_id = b.id) as jumlah_kunjungan,
        (SELECT MAX(tanggal) FROM kunjungan k WHERE k.balita_id = b.id) as kunjungan_terakhir
       FROM balita b JOIN orang_tua o ON b.orang_tua_id = o.id
       ORDER BY b.nama ASC`
    )
    .all();
  res.render('kader-dashboard', { balitaList, formatTanggal, hitungUmurBulan, formatUmur });
});

app.get('/kader/balita/:id', requireKader, (req, res) => {
  const data = getBalitaDetail(req.params.id);
  if (!data) return res.redirect('/kader/dashboard');
  res.render('kader-detail', { ...data, formatTanggal });
});

app.get('/kader/tambah-balita', requireKader, (req, res) => {
  res.render('kader-tambah-balita', { error: null, success: null });
});

app.post('/kader/tambah-balita', requireKader, (req, res) => {
  const { nik_ibu, nama_ibu, password, no_hp, alamat, nama_anak, tanggal_lahir, jenis_kelamin, nik_balita } = req.body;
  try {
    let ortu = db.prepare('SELECT * FROM orang_tua WHERE nik = ?').get(nik_ibu?.trim());
    if (!ortu) {
      const result = db
        .prepare('INSERT INTO orang_tua (nik, nama, password, no_hp, alamat) VALUES (?, ?, ?, ?, ?)')
        .run(nik_ibu.trim(), nama_ibu, bcrypt.hashSync(password || 'ibu123', 10), no_hp, alamat);
      ortu = { id: result.lastInsertRowid };
    }
    db.prepare(
      'INSERT INTO balita (orang_tua_id, nama, tanggal_lahir, jenis_kelamin, nik_balita) VALUES (?, ?, ?, ?, ?)'
    ).run(ortu.id, nama_anak, tanggal_lahir, jenis_kelamin, nik_balita || null);
    res.redirect('/kader/dashboard');
  } catch (err) {
    res.render('kader-tambah-balita', { error: 'Gagal menyimpan data. Pastikan NIK unik dan data lengkap.', success: null });
  }
});

app.get('/kader/kunjungan/:balitaId', requireKader, (req, res) => {
  const balita = db.prepare('SELECT * FROM balita WHERE id = ?').get(req.params.balitaId);
  if (!balita) return res.redirect('/kader/dashboard');
  res.render('kader-tambah-kunjungan', { balita, error: null, formatTanggal });
});

app.post('/kader/kunjungan/:balitaId', requireKader, (req, res) => {
  const { tanggal, berat_badan, tinggi_badan, lingkar_kepala, catatan } = req.body;
  const balita = db.prepare('SELECT * FROM balita WHERE id = ?').get(req.params.balitaId);
  if (!balita) return res.redirect('/kader/dashboard');
  try {
    db.prepare(
      'INSERT INTO kunjungan (balita_id, tanggal, berat_badan, tinggi_badan, lingkar_kepala, catatan) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.params.balitaId, tanggal, parseFloat(berat_badan), parseFloat(tinggi_badan), lingkar_kepala ? parseFloat(lingkar_kepala) : null, catatan);
    res.redirect(`/kader/balita/${req.params.balitaId}`);
  } catch (err) {
    res.render('kader-tambah-kunjungan', { balita, error: 'Gagal menyimpan kunjungan.', formatTanggal });
  }
});

app.get('/kader/imunisasi/:balitaId', requireKader, (req, res) => {
  const balita = db.prepare('SELECT * FROM balita WHERE id = ?').get(req.params.balitaId);
  if (!balita) return res.redirect('/kader/dashboard');
  res.render('kader-tambah-imunisasi', { balita, error: null });
});

app.post('/kader/imunisasi/:balitaId', requireKader, (req, res) => {
  const { nama_vaksin, tanggal, catatan } = req.body;
  db.prepare('INSERT INTO imunisasi (balita_id, nama_vaksin, tanggal, catatan) VALUES (?, ?, ?, ?)').run(
    req.params.balitaId, nama_vaksin, tanggal, catatan
  );
  res.redirect(`/kader/balita/${req.params.balitaId}`);
});

app.get('/kader/vitamin/:balitaId', requireKader, (req, res) => {
  const balita = db.prepare('SELECT * FROM balita WHERE id = ?').get(req.params.balitaId);
  if (!balita) return res.redirect('/kader/dashboard');
  res.render('kader-tambah-vitamin', { balita, error: null });
});

app.post('/kader/vitamin/:balitaId', requireKader, (req, res) => {
  const { jenis, tanggal, catatan } = req.body;
  db.prepare('INSERT INTO vitamin (balita_id, jenis, tanggal, catatan) VALUES (?, ?, ?, ?)').run(
    req.params.balitaId, jenis, tanggal, catatan
  );
  res.redirect(`/kader/balita/${req.params.balitaId}`);
});

app.listen(PORT, () => {
  console.log(`\n🏥 Posyandu Web berjalan di http://localhost:${PORT}`);
  console.log('   Login Ibu  → NIK: 3273011506890001 / Password: ibu123');
  console.log('   Login Anak → Nama: Ahmad Fadli / Tgl Lahir: 2023-03-15');
  console.log('   Login Kader → Username: kader / Password: kader123\n');
});
