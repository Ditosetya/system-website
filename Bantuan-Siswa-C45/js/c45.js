/* Normalisasi atribut dan prediksi menggunakan pohon keputusan C4.5 bawaan */
(function () {
  'use strict';

  const FEATURE_NAMES = [
    'Jumlah Saudara Sekolah', 'Pekerjaan Ayah', 'Pendidikan Akhir Ayah',
    'Pekerjaan Ibu', 'Pendidikan Akhir Ibu', 'Penerima PIP',
    'Status Orang Tua', 'Kehadiran Siswa'
  ];

  const MAPPINGS = {
    'Jumlah Saudara Sekolah': { 'tidak ada': 0, 'sedang': 1, 'banyak': 2 },
    'Pekerjaan Ayah': {
      'nelayan': 1, 'petani': 2, 'peternak': 3, 'pns/tni/polri': 4,
      'karyawan swasta': 5, 'pedagang kecil': 6, 'pedagang besar': 7,
      'wiraswasta': 8, 'wirausaha': 9, 'buruh': 10, 'buruh tani': 10,
      'pensiunan': 11, 'tenaga kerja indonesia': 12, 'tki': 12,
      'karyawan bumn': 13, 'sudah meninggal': 14, 'tidak bekerja': 15,
      'ibu rumah tangga': 15
    },
    'Pendidikan Akhir Ayah': { 'rendah': 1, 'sedang': 2, 'tinggi': 3 },
    'Pekerjaan Ibu': {
      'nelayan': 1, 'petani': 2, 'peternak': 3, 'pns/tni/polri': 4,
      'karyawan swasta': 5, 'pedagang kecil': 6, 'pedagang besar': 7,
      'wiraswasta': 8, 'wirausaha': 9, 'buruh': 10, 'buruh tani': 10,
      'pensiunan': 11, 'tenaga kerja indonesia': 12, 'tki': 12,
      'karyawan bumn': 13, 'sudah meninggal': 14, 'tidak bekerja': 15,
      'ibu rumah tangga': 15
    },
    'Pendidikan Akhir Ibu': { 'rendah': 1, 'sedang': 2, 'tinggi': 3 },
    'Penerima PIP': { 'tidak': 0, 'ya': 1 },
    'Status Orang Tua': { 'lengkap': 1, 'yatim': 2, 'piatu': 3, 'yatim piatu': 4 },
    'Kehadiran Siswa': { 'tinggi': 1, 'sedang': 2, 'rendah': 3 }
  };

  function normalizeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function encodeRecord(record) {
    const source = {
      'Jumlah Saudara Sekolah': record.siblings,
      'Pekerjaan Ayah': record.fatherJob,
      'Pendidikan Akhir Ayah': record.fatherEdu,
      'Pekerjaan Ibu': record.motherJob,
      'Pendidikan Akhir Ibu': record.motherEdu,
      'Penerima PIP': record.pip,
      'Status Orang Tua': record.parents,
      'Kehadiran Siswa': record.attendance
    };
    const encoded = {};
    for (const feature of FEATURE_NAMES) {
      const raw = source[feature];
      const map = MAPPINGS[feature];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        encoded[feature] = raw;
      } else {
        const key = normalizeText(raw);
        if (!Object.prototype.hasOwnProperty.call(map, key)) {
          throw new Error(`Nilai "${raw}" pada atribut "${feature}" tidak dikenali.`);
        }
        encoded[feature] = map[key];
      }
    }
    return encoded;
  }

  function predictTree(tree, encoded, fallbackClass) {
    let node = tree;
    while (node && node.value === null) {
      const feature = node.feature;
      const value = encoded[feature];
      const child = node.children ? node.children[String(value)] : null;
      if (!child) return fallbackClass;
      node = child;
    }
    return node && node.value !== null ? Number(node.value) : fallbackClass;
  }

  // Aplikasi menggunakan model C4.5 bawaan dan tidak menyediakan pelatihan ulang di browser.
  window.C45 = {
    FEATURE_NAMES,
    MAPPINGS,
    encodeRecord,
    predictTree
  };
})();