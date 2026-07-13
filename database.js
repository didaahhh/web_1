const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data.json');

let data = {
  orang_tua: [],
  balita: [],
  kunjungan: [],
  imunisasi: [],
  vitamin: [],
  kader: [],
  _counters: { orang_tua: 0, balita: 0, kunjungan: 0, imunisasi: 0, vitamin: 0, kader: 0 },
};

function load() {
  if (fs.existsSync(DB_PATH)) {
    data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  }
}

function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function nextId(table) {
  data._counters[table] = (data._counters[table] || 0) + 1;
  return data._counters[table];
}

const db = {
  prepare(sql) {
    return {
      get(...params) {
        return db._query(sql, params, 'get');
      },
      all(...params) {
        return db._query(sql, params, 'all');
      },
      run(...params) {
        return db._query(sql, params, 'run');
      },
    };
  },

  _query(sql, params, mode) {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('SELECT COUNT(*)')) {
      const table = s.match(/FROM (\w+)/)[1];
      const c = data[table].length;
      return mode === 'get' ? { c } : [{ c }];
    }

    if (s.includes('SELECT * FROM kader WHERE username')) {
      const row = data.kader.find((k) => k.username === params[0]);
      return mode === 'get' ? row || undefined : row ? [row] : [];
    }

    if (s.includes('SELECT * FROM orang_tua WHERE nik')) {
      const row = data.orang_tua.find((o) => o.nik === params[0]);
      return mode === 'get' ? row || undefined : row ? [row] : [];
    }

    if (s.includes('SELECT * FROM orang_tua WHERE id')) {
      const row = data.orang_tua.find((o) => o.id === Number(params[0]));
      return mode === 'get' ? row || undefined : row ? [row] : [];
    }

    if (s.includes('SELECT * FROM balita WHERE orang_tua_id = ? LIMIT 1')) {
      const row = data.balita.find((b) => b.orang_tua_id === Number(params[0]));
      return mode === 'get' ? row || undefined : row ? [row] : [];
    }

    if (s.includes('SELECT * FROM balita WHERE LOWER(nama)')) {
      const row = data.balita.find(
        (b) => b.nama.toLowerCase() === params[0].toLowerCase() && b.tanggal_lahir === params[1]
      );
      return mode === 'get' ? row || undefined : row ? [row] : [];
    }

    if (s.includes('SELECT * FROM balita WHERE id = ? AND orang_tua_id')) {
      const row = data.balita.find((b) => b.id === Number(params[0]) && b.orang_tua_id === Number(params[1]));
      return mode === 'get' ? row || undefined : row ? [row] : [];
    }

    if (s.includes('SELECT * FROM balita WHERE id = ?') && !s.includes('orang_tua_id')) {
      const row = data.balita.find((b) => b.id === Number(params[0]));
      return mode === 'get' ? row || undefined : row ? [row] : [];
    }

    if (s.includes('SELECT id, nama, tanggal_lahir, jenis_kelamin FROM balita WHERE orang_tua_id')) {
      const rows = data.balita
        .filter((b) => b.orang_tua_id === Number(params[0]))
        .map(({ id, nama, tanggal_lahir, jenis_kelamin }) => ({ id, nama, tanggal_lahir, jenis_kelamin }));
      return mode === 'all' ? rows : rows[0];
    }

    if (s.includes('SELECT b.*, o.nama as nama_ibu, o.nik as nik_ibu, o.no_hp, o.alamat')) {
      const balitaId = Number(params[0]);
      const b = data.balita.find((x) => x.id === balitaId);
      if (!b) return mode === 'get' ? undefined : [];
      const o = data.orang_tua.find((x) => x.id === b.orang_tua_id);
      const row = { ...b, nama_ibu: o.nama, nik_ibu: o.nik, no_hp: o.no_hp, alamat: o.alamat };
      return mode === 'get' ? row : [row];
    }

    if (s.includes('SELECT * FROM kunjungan WHERE balita_id')) {
      const rows = data.kunjungan
        .filter((k) => k.balita_id === Number(params[0]))
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal));
      return mode === 'all' ? rows : rows[0];
    }

    if (s.includes('SELECT * FROM imunisasi WHERE balita_id')) {
      const rows = data.imunisasi
        .filter((i) => i.balita_id === Number(params[0]))
        .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
      return mode === 'all' ? rows : rows[0];
    }

    if (s.includes('SELECT * FROM vitamin WHERE balita_id')) {
      const rows = data.vitamin
        .filter((v) => v.balita_id === Number(params[0]))
        .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
      return mode === 'all' ? rows : rows[0];
    }

    if (s.includes('jumlah_kunjungan') && s.includes('kunjungan_terakhir')) {
      const rows = data.balita.map((b) => {
        const o = data.orang_tua.find((x) => x.id === b.orang_tua_id);
        const kunj = data.kunjungan.filter((k) => k.balita_id === b.id);
        const dates = kunj.map((k) => k.tanggal).sort();
        return {
          ...b,
          nama_ibu: o.nama,
          nik_ibu: o.nik,
          jumlah_kunjungan: kunj.length,
          kunjungan_terakhir: dates.length ? dates[dates.length - 1] : null,
        };
      }).sort((a, b) => a.nama.localeCompare(b.nama));
      return mode === 'all' ? rows : rows[0];
    }

    if (s.startsWith('INSERT INTO kader')) {
      const id = nextId('kader');
      data.kader.push({ id, username: params[0], nama: params[1], password: params[2], created_at: new Date().toISOString() });
      save();
      return { lastInsertRowid: id };
    }

    if (s.startsWith('INSERT INTO orang_tua')) {
      const id = nextId('orang_tua');
      data.orang_tua.push({
        id, nik: params[0], nama: params[1], password: params[2], no_hp: params[3], alamat: params[4],
        created_at: new Date().toISOString(),
      });
      save();
      return { lastInsertRowid: id };
    }

    if (s.startsWith('INSERT INTO balita')) {
      const id = nextId('balita');
      data.balita.push({
        id, orang_tua_id: Number(params[0]), nama: params[1], tanggal_lahir: params[2],
        jenis_kelamin: params[3], nik_balita: params[4], created_at: new Date().toISOString(),
      });
      save();
      return { lastInsertRowid: id };
    }

    if (s.startsWith('INSERT INTO kunjungan')) {
      const id = nextId('kunjungan');
      data.kunjungan.push({
        id, balita_id: Number(params[0]), tanggal: params[1], berat_badan: params[2],
        tinggi_badan: params[3], lingkar_kepala: params[4], catatan: params[5],
        created_at: new Date().toISOString(),
      });
      save();
      return { lastInsertRowid: id };
    }

    if (s.startsWith('INSERT INTO imunisasi')) {
      const id = nextId('imunisasi');
      data.imunisasi.push({ id, balita_id: Number(params[0]), nama_vaksin: params[1], tanggal: params[2], catatan: params[3] });
      save();
      return { lastInsertRowid: id };
    }

    if (s.startsWith('INSERT INTO vitamin')) {
      const id = nextId('vitamin');
      data.vitamin.push({ id, balita_id: Number(params[0]), jenis: params[1], tanggal: params[2], catatan: params[3] });
      save();
      return { lastInsertRowid: id };
    }

    return mode === 'get' ? undefined : mode === 'all' ? [] : { lastInsertRowid: 0 };
  },
};

function initDatabase() {
  load();
  if (data.kader.length === 0) {
    db.prepare('INSERT INTO kader (username, nama, password) VALUES (?, ?, ?)').run(
      'kader', 'Kader Posyandu Candiareng', bcrypt.hashSync('kader123', 10)
    );
  }
  if (data.orang_tua.length === 0) {
    const ortuId = db.prepare('INSERT INTO orang_tua (nik, nama, password, no_hp, alamat) VALUES (?, ?, ?, ?, ?)').run(
      '3273011506890001', 'Siti Aminah', bcrypt.hashSync('ibu123', 10), '081234567890', 'Desa Candiareng, RT 01/RW 02'
    ).lastInsertRowid;

    const balitaId = db.prepare('INSERT INTO balita (orang_tua_id, nama, tanggal_lahir, jenis_kelamin, nik_balita) VALUES (?, ?, ?, ?, ?)').run(
      ortuId, 'Ahmad Fadli', '2023-03-15', 'L', '3273011503230001'
    ).lastInsertRowid;

    const kunjunganData = [
      ['2024-01-10', 9.2, 72.5, 44.0, 'Pertumbuhan normal'],
      ['2024-04-12', 9.8, 75.0, 44.5, 'BB naik baik'],
      ['2024-07-15', 10.1, 77.2, 45.0, 'Perlu perhatian tinggi badan'],
      ['2024-10-08', 10.5, 78.8, 45.2, 'Monitoring stunting'],
      ['2025-01-14', 11.0, 80.5, 45.5, 'Sedikit di bawah standar TB'],
      ['2025-04-10', 11.4, 82.0, 46.0, 'Ada perbaikan'],
    ];
    const insK = db.prepare('INSERT INTO kunjungan (balita_id, tanggal, berat_badan, tinggi_badan, lingkar_kepala, catatan) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [tgl, bb, tb, lk, cat] of kunjunganData) {
      insK.run(balitaId, tgl, bb, tb, lk, cat);
    }

    db.prepare('INSERT INTO imunisasi (balita_id, nama_vaksin, tanggal, catatan) VALUES (?, ?, ?, ?)').run(balitaId, 'BCG & Hepatitis B', '2023-03-16', 'Dosis 0');
    db.prepare('INSERT INTO imunisasi (balita_id, nama_vaksin, tanggal, catatan) VALUES (?, ?, ?, ?)').run(balitaId, 'DPT-HB-Hib 1', '2023-05-20', 'Selesai');
    db.prepare('INSERT INTO imunisasi (balita_id, nama_vaksin, tanggal, catatan) VALUES (?, ?, ?, ?)').run(balitaId, 'Campak', '2024-03-18', 'Selesai');
    db.prepare('INSERT INTO vitamin (balita_id, jenis, tanggal, catatan) VALUES (?, ?, ?, ?)').run(balitaId, 'Vitamin A', '2024-08-15', 'Kapsul biru');
    db.prepare('INSERT INTO vitamin (balita_id, jenis, tanggal, catatan) VALUES (?, ?, ?, ?)').run(balitaId, 'Vitamin A', '2025-02-10', 'Kapsul merah');

    const ortuId2 = db.prepare('INSERT INTO orang_tua (nik, nama, password, no_hp, alamat) VALUES (?, ?, ?, ?, ?)').run(
      '3273012007900002', 'Dewi Lestari', bcrypt.hashSync('ibu123', 10), '081298765432', 'Desa Candiareng, RT 03/RW 02'
    ).lastInsertRowid;
    db.prepare('INSERT INTO balita (orang_tua_id, nama, tanggal_lahir, jenis_kelamin, nik_balita) VALUES (?, ?, ?, ?, ?)').run(
      ortuId2, 'Putri Ayu', '2024-06-20', 'P', '3273012006240002'
    );
  }
}

module.exports = { db, initDatabase };
