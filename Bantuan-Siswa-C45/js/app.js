
/* Aplikasi BANSOS C4.5 versi HTML/CSS/JavaScript tanpa backend. */
(function () {
  'use strict';

  const STORAGE = {
    records: 'bansos_c45_records_v1',
    account: 'bansos_c45_account_v2',
    model: 'bansos_c45_model_v1',
    lastResult: 'bansos_c45_last_result_v1'
  };

  const PAGE_TITLES = {
    dashboard: 'Halaman Utama',
    records: 'Halaman Klasifikasi',
    form: 'Halaman Tambah Data',
    result: 'Hasil Klasifikasi',
    accuracy: 'Halaman Akurasi Model',
    settings: 'Edit Akun'
  };

  const OPTIONS = {
    school: ['SD', 'MI'],
    siblings: ['Tidak Ada', 'Sedang', 'Banyak'],
    fatherJob: [
      'Nelayan', 'Petani', 'Peternak', 'PNS/TNI/POLRI',
      'Karyawan Swasta', 'Pedagang Kecil', 'Pedagang Besar',
      'Wiraswasta', 'Wirausaha', 'Buruh', 'Pensiunan',
      'Tenaga Kerja Indonesia', 'Karyawan BUMN',
      'Sudah Meninggal', 'Tidak Bekerja'
    ],
    motherJob: [
      'Nelayan', 'Petani', 'Peternak', 'PNS/TNI/POLRI',
      'Karyawan Swasta', 'Pedagang Kecil', 'Pedagang Besar',
      'Wiraswasta', 'Wirausaha', 'Buruh', 'Pensiunan',
      'Tenaga Kerja Indonesia', 'Karyawan BUMN',
      'Sudah Meninggal', 'Ibu Rumah Tangga'
    ],
    education: ['Rendah', 'Sedang', 'Tinggi'],
    pip: ['Tidak', 'Ya'],
    parents: ['Lengkap', 'Yatim', 'Piatu', 'Yatim Piatu'],
    attendance: ['Tinggi', 'Sedang', 'Rendah']
  };

  const state = {
    page: 'dashboard',
    records: [],
    editingId: null,
    search: '',
    currentPage: 1,
    pageSize: 10,
    lastResult: null,
    model: null,
    toastTimer: null
  };

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

  function safeParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('id-ID')
      .format(Number(value) || 0);
  }

  function formatPercent(value) {
    return `${(Number(value || 0) * 100)
      .toFixed(2)
      .replace('.', ',')}%`;
  }

  function formatDate(date = new Date()) {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(date);
  }

  // PENYIMPANAN DATA KLASIFIKASI
  function loadRecords() {
    const existing = safeParse(
      localStorage.getItem(STORAGE.records),
      null
    );

    if (Array.isArray(existing)) {
      state.records = existing;
    } else {
      state.records = Array.isArray(window.INITIAL_RECORDS)
        ? window.INITIAL_RECORDS.slice()
        : [];

      saveRecords(state.records);
    }
  }

  // Menyimpan data siswa ke localStorage.
  function saveRecords(records = state.records) {
    if (!Array.isArray(records)) {
      throw new TypeError(
        'Data klasifikasi harus berbentuk array.'
      );
    }

    try {
      localStorage.setItem(
        STORAGE.records,
        JSON.stringify(records)
      );

      return true;

    } catch (error) {
      console.error(
        'Gagal menyimpan data klasifikasi ke localStorage:',
        error
      );

      if (error && error.name === 'QuotaExceededError') {
        throw new Error(
          'Penyimpanan browser penuh. Hapus sebagian data atau kosongkan penyimpanan situs, lalu coba lagi.'
        );
      }

      throw new Error(
        'Data gagal disimpan ke penyimpanan browser. Pastikan izin penyimpanan browser tidak diblokir, lalu coba lagi.'
      );
    }
  }

  // MODEL C4.5
  function loadModel() {
    const saved = safeParse(
      localStorage.getItem(STORAGE.model),
      null
    );

    state.model = saved && saved.tree
      ? saved
      : (window.ORIGINAL_MODEL || null);
  }

  function saveModel(model) {
    state.model = model;

    localStorage.setItem(
      STORAGE.model,
      JSON.stringify(model)
    );
  }

  // LOGIN DAN AUTENTIKASI
  async function passwordDigest(password) {
    if (
      window.crypto &&
      crypto.subtle &&
      window.TextEncoder
    ) {
      const bytes = new TextEncoder().encode(password);

      const hash = await crypto.subtle.digest(
        'SHA-256',
        bytes
      );

      return 'sha256:' +
        [...new Uint8Array(hash)]
          .map(byte => byte.toString(16).padStart(2, '0'))
          .join('');
    }

    // Fallback untuk browser lama.
    // Ini bukan perlindungan keamanan server.
    return 'local:' +
      btoa(unescape(encodeURIComponent(password)));
  }

  function notify(message, type = 'success') {
    const toast = $('#toast');

    toast.textContent = message;
    toast.className = `toast show ${type}`;

    clearTimeout(state.toastTimer);

    state.toastTimer = setTimeout(() => {
      toast.className = 'toast';
    }, 3000);
  }

  function showAuth() {
    $('#authScreen').classList.remove('hidden');
    $('#appShell').classList.add('hidden');

    $('#authSubmit').innerHTML = 'Masuk';

    $('#confirmPasswordGroup').classList.add('hidden');
    $('#authConfirmPassword').required = false;

    $('#authUsername').value = '';
    $('#authPassword').value = '';
    $('#authConfirmPassword').value = '';

    $('#authPassword').autocomplete = 'current-password';
    $('#authError').classList.add('hidden');
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();

    const username = $('#authUsername').value.trim();
    const password = $('#authPassword').value;

    const account = safeParse(
      localStorage.getItem(STORAGE.account),
      null
    );

    const error = $('#authError');

    error.classList.add('hidden');

    if (!username || !password) {
      error.textContent = 'Username dan password wajib diisi.';
      error.classList.remove('hidden');
      return;
    }

    if (!account) {
      error.textContent =
        'Akun administrator belum diinisialisasi. Muat ulang halaman untuk mencoba kembali.';

      error.classList.remove('hidden');
      return;
    }

    const digest = await passwordDigest(password);

    if (
      username === account.username &&
      digest === account.passwordDigest
    ) {
      sessionStorage.setItem(
        'bansos_c45_logged_in',
        '1'
      );

      enterApp();

      notify(
        'Login berhasil. Selamat datang, administrator.'
      );

    } else {
      error.textContent =
        'Username atau password tidak sesuai.';

      error.classList.remove('hidden');
    }
  }

  function enterApp() {
    $('#authScreen').classList.add('hidden');
    $('#appShell').classList.remove('hidden');

    updateTopbar();
    renderPage();
  }

  function updateTopbar() {
    const account = safeParse(
      localStorage.getItem(STORAGE.account),
      { username: 'Administrator' }
    );

    const username = account.username || 'Administrator';

    $('#profileName').textContent = username;

    $('#profileAvatar').textContent =
      username.charAt(0).toUpperCase();

    $('#currentDate').textContent = formatDate();

    $('#footerYear').textContent =
      new Date().getFullYear();
  }

  // NAVIGASI HALAMAN
  function enterPage(page) {
    if (
      sessionStorage.getItem('bansos_c45_logged_in') !== '1'
    ) {
      showAuth();
      return;
    }

    state.page = page;

    if (page !== 'records') {
      state.search = '';
    }

    if (page !== 'records') {
      state.currentPage = 1;
    }

    renderPage();
  }

  function renderPage() {
    const title =
      PAGE_TITLES[state.page] || 'Dashboard';

    $('#pageTitle').textContent = title;

    $$('.nav-link[data-page]').forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.page === state.page ||
        (
          state.page === 'form' &&
          button.dataset.page === 'records'
        )
      );
    });

    const content = $('#pageContent');

    switch (state.page) {
      case 'records':
        content.innerHTML = renderRecordsPage();
        break;

      case 'form':
        content.innerHTML = renderFormPage();
        break;

      case 'result':
        content.innerHTML = renderResultPage();
        break;

      case 'accuracy':
        content.innerHTML = renderAccuracyPage();
        break;

      case 'settings':
        content.innerHTML = renderSettingsPage();
        break;

      default:
        content.innerHTML = renderDashboardPage();
        break;
    }

    content.focus({ preventScroll: true });
  }

  // DASHBOARD
  function statusBadge(status) {
    const isEligible = status === 'Layak';

    return `
      <span class="status-badge ${
        isEligible ? 'layak' : 'tidak-layak'
      }">
        ${escapeHtml(status)}
      </span>
    `;
  }

  function getStats() {
    const total = state.records.length;

    const eligible = state.records.filter(
      record => record.status === 'Layak'
    ).length;

    const ineligible = state.records.filter(
      record => record.status === 'Tidak Layak'
    ).length;

    const sd = state.records.filter(
      record => record.school === 'SD'
    ).length;

    const mi = state.records.filter(
      record => record.school === 'MI'
    ).length;

    return { total, eligible, ineligible, sd, mi };
  }

  function renderDashboardPage() {
    const account = safeParse(
      localStorage.getItem(STORAGE.account),
      { username: 'admin123' }
    );

    const username = escapeHtml(
      account?.username || 'admin123'
    );

    return `
      <div class="dashboard-original">
        <section class="dashboard-welcome">
          <h2>Selamat Datang</h2>
          <p>${username}</p>
        </section>
        <section class="dashboard-menu-grid" aria-label="Menu utama">
          <button type="button" class="dashboard-menu-card" data-page="records">
            <h3>Klasifikasi</h3>
            <p>Kelola data klasifikasi</p>
          </button>
          <button type="button" class="dashboard-menu-card" data-page="accuracy">
            <h3>Akurasi</h3>
            <p>Confusion Matrix &amp; hasil model</p>
          </button>
          <button type="button" class="dashboard-menu-card" data-page="settings">
            <h3>Edit Akun</h3>
            <p>Ubah username &amp; password</p>
          </button>
        </section>
      </div>
    `;
  }

  // HALAMAN DATA KLASIFIKASI
  function filteredRecords() {
    const query = state.search
      .trim()
      .toLocaleLowerCase('id-ID');

    const records = [...state.records].sort(
      (a, b) => Number(a.id) - Number(b.id)
    );

    if (!query) {
      return records;
    }

    return records.filter(record =>
      Object.values(record).some(value =>
        String(value ?? '')
          .toLocaleLowerCase('id-ID')
          .includes(query)
      )
    );
  }

  function renderRecordsPage() {
    const records = filteredRecords();

    const pages = Math.max(
      1, Math.ceil(records.length / state.pageSize)
    );

    state.currentPage = Math.min(
      state.currentPage, pages
    );

    const start = (state.currentPage - 1) * state.pageSize;

    const visible = records.slice(
      start, start + state.pageSize
    );

    const body = visible.map((record, index) => `
      <tr>
        <td>${start + index + 1}</td>
        <td class="name-cell" title="${escapeHtml(record.name)}">
          ${escapeHtml(record.name)}
        </td>
        <td>${escapeHtml(record.school)}</td>
        <td>${escapeHtml(record.siblings)}</td>
        <td>${escapeHtml(record.fatherJob)}</td>
        <td>${escapeHtml(record.fatherEdu)}</td>
        <td>${escapeHtml(record.motherJob)}</td>
        <td>${escapeHtml(record.motherEdu)}</td>
        <td>${escapeHtml(record.pip)}</td>
        <td>${escapeHtml(record.parents)}</td>
        <td>${escapeHtml(record.attendance)}</td>
        <td>${statusBadge(record.status)}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="action-button" data-action="edit" data-id="${record.id}" title="Edit data siswa" aria-label="Edit data ${escapeHtml(record.name)}">
              <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>
                <path d="m15 5 4 4"/>
              </svg>
              <span>Edit</span>
            </button>
            <button type="button" class="action-button delete" data-action="delete" data-id="${record.id}" title="Hapus data siswa" aria-label="Hapus data ${escapeHtml(record.name)}">
              <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 6h18"/>
                <path d="M8 6V4h8v2"/>
                <path d="m19 6-1 14H6L5 6"/>
                <path d="M10 11v5M14 11v5"/>
              </svg>
              <span>Hapus</span>
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    const pageButtons = [];

    const first = Math.max(
      1,
      state.currentPage - 2
    );

    const last = Math.min(
      pages,
      first + 4
    );

    for (let p = first; p <= last; p++) {
      pageButtons.push(`
        <button class="page-button ${p === state.currentPage ? 'active' : ''}"data-action="page" data-page-number="${p}">
          ${p}
        </button>
      `);
    }

    return `
      <div class="page-heading">
        <div>
          <h2>Data Klasifikasi Siswa</h2>
          <p>
            Kelola data siswa SD/MI dan hasil prediksi kelayakan bantuan.
          </p>
        </div>
        <div class="toolbar-actions">
          <button class="button button-success" data-action="export-csv">Ekspor Excel (CSV)</button>
          <button class="button button-primary" data-action="add-record">＋ Tambah Data</button>
        </div>
      </div>
      <div class="toolbar">
        <div class="search-wrap">
          <span class="search-icon">⌕</span>
          <input class="search-input" id="recordSearch" type="search" placeholder="Cari nama, sekolah, pekerjaan, status..." value="${escapeHtml(state.search)}">
        </div>
        <div class="toolbar-actions">
          <span class="text-muted" style="font-size:10px;align-self:center">${formatNumber(records.length)} data ditemukan</span>
        </div>
      </div>
      <article class="card table-card">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>No</th>
                <th>Nama Siswa</th>
                <th>Sekolah</th>
                <th>Saudara</th>
                <th>Pekerjaan Ayah</th>
                <th>Pend. Ayah</th>
                <th>Pekerjaan Ibu</th>
                <th>Pend. Ibu</th>
                <th>PIP</th>
                <th>Status Ortu</th>
                <th>Kehadiran</th>
                <th>Hasil</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${body ||
                `
                  <tr>
                    <td colspan="13">
                      <div class="empty-state">
                        <strong>Data tidak ditemukan</strong>
                        Coba gunakan kata kunci pencarian yang berbeda.
                      </div>
                    </td>
                  </tr>
                `
              }
            </tbody>
          </table>
        </div>
        <div class="table-footer">
          <span class="table-summary">
            Menampilkan
            ${records.length ? start + 1 : 0}–${Math.min(
              start + state.pageSize, records.length
            )}
            dari ${formatNumber(records.length)} data
          </span>
          <div class="pagination">
            <button class="page-button" data-action="page" data-page-number="${Math.max(
                1, state.currentPage - 1)}"
              ${state.currentPage === 1 ? 'disabled' : ''}>
              ‹</button>

            ${pageButtons.join('')}
            <button
              class="page-button"
              data-action="page"
              data-page-number="${Math.min(
                pages, state.currentPage + 1)}"
              ${state.currentPage === pages ? 'disabled' : ''}>
              ›</button>
          </div>
        </div>
      </article>
    `;
  }

  // FORM TAMBAH DAN EDIT DATA SISWA
  function optionMarkup(options, selected) {
    return options.map(option => `
      <option value="${escapeHtml(option)}"
        ${option === selected ? 'selected' : ''}>
        ${escapeHtml(option)}
      </option>
    `).join('');
  }

  function selectField(
    label, name, options, selected, hint = ''
  ) {
    return `
      <div class="field-group">
        <label for="field-${name}">
          ${label}
        </label>
        <select id="field-${name}" name="${name}" required>
          ${optionMarkup(options, selected || options[0])}
        </select>
        ${hint
            ? `<small class="text-muted">${hint}</small>`
            : ''
          }
      </div>
    `;
  }

  function inputField(
    label, name, value = '', placeholder = ''
  ) {
    return `
      <div class="field-group">
        <label for="field-${name}">${label}</label>
        <input id="field-${name}" name="${name}" type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" required>
      </div>
    `;
  }

  function renderFormPage() {
    const record = state.editingId
      ? state.records.find(
          item => Number(item.id) === Number(state.editingId)
        )
      : null;

    const value = (key, fallback) =>
      record ? record[key] : fallback;

    return `
      <div class="page-heading">
        <div>
          <h2>${record ? 'Edit Data Siswa' : 'Tambah Data Siswa'}</h2>
          <p>Lengkapi atribut siswa untuk memperoleh hasil klasifikasi C4.5</p>
        </div>
        <button class="button button-secondary" data-page="records">Kembali</button>
      </div>
      <div class="form-layout">
        <article class="card card-padding">
          <form id="studentForm">
            <div class="form-grid">
              <div class="form-section-title">IDENTITAS SISWA</div>
              <div class="form-span">
                ${inputField('Nama Siswa', 'name', value('name', ''), 'Masukkan nama lengkap siswa')}
              </div>
              ${selectField('Pendidikan Siswa', 'school', OPTIONS.school, value('school', 'SD'))}
              ${selectField('Jumlah Saudara yang Sekolah', 'siblings', OPTIONS.siblings, value('siblings', 'Sedang'), 'Tidak Ada, Sedang (1–2), atau Banyak (≥3).')}
              <div class="form-section-title">KONDISI ORANG TUA</div>
              ${selectField('Pekerjaan Ayah', 'fatherJob', OPTIONS.fatherJob, value('fatherJob', 'Buruh'))}
              ${selectField('Pendidikan Akhir Ayah', 'fatherEdu', OPTIONS.education, value('fatherEdu', 'Rendah'))}
              ${selectField('Pekerjaan Ibu', 'motherJob', OPTIONS.motherJob, value('motherJob', 'Ibu Rumah Tangga'))}
              ${selectField('Pendidikan Akhir Ibu', 'motherEdu', OPTIONS.education, value('motherEdu', 'Rendah'))}
              <div class="form-section-title">INFORMASI BANTUAN DAN KEHADIRAN</div>
              ${selectField('Penerima PIP', 'pip', OPTIONS.pip, value('pip', 'Tidak'))}
              ${selectField('Status Orang Tua', 'parents', OPTIONS.parents, value('parents', 'Lengkap'))}
              ${selectField('Kehadiran Siswa', 'attendance', OPTIONS.attendance, value('attendance', 'Tinggi'), 'Tinggi (>80%), Sedang (75–80%), atau Rendah (<75%).')}
            </div>
            <div class="form-actions">
              <button type="submit" class="button button-primary">
                ${
                  record
                    ? 'Simpan Perubahan & Klasifikasi'
                    : 'Simpan & Klasifikasikan'
                }
              </button>
              <button type="button" class="button button-secondary" data-page="records">Batal</button>
            </div>
          </form>
        </article>
        <aside class="card helper-card">
          <h3>Informasi Klasifikasi</h3>
          <p>Setelah formulir disimpan, browser menjalankan model pohon keputusan C4.5 yang disertakan di dalam aplikasi.</p>
          <ul class="helper-list">
            <li>
              <span class="helper-check">✓</span>
              <span>Delapan atribut digunakan sebagai fitur model.</span>
            </li>
            <li>
              <span class="helper-check">✓</span>
              <span>Nama dan jenjang sekolah hanya digunakan sebagai identitas data.</span>
            </li>
            <li>
              <span class="helper-check">✓</span>
              <span>Hasil klasifikasi disimpan dalam penyimpanan lokal browser.</span>
            </li>
          </ul>
          <div class="warning-note">
            Hasil klasifikasi merupakan rekomendasi berdasarkan pola dataset, bukan keputusan final penerima bantuan. Tetap lakukan verifikasi kondisi lapangan.
          </div>
        </aside>
      </div>
    `;
  }

  // PENJELASAN HASIL PREDIKSI
  function explainPrediction(record, status) {
    const notes = [];

    if (record.pip === 'Ya') {
      notes.push('siswa tercatat sebagai penerima PIP');
    }

    if (record.parents !== 'Lengkap') {
      notes.push(
        `status orang tua ${record.parents.toLowerCase()}`
      );
    }

    if (record.siblings === 'Banyak') {
      notes.push(
        'memiliki banyak saudara yang masih sekolah'
      );
    }

    if (
      record.fatherEdu === 'Rendah' ||
      record.motherEdu === 'Rendah'
    ) {
      notes.push(
        'terdapat pendidikan orang tua pada kategori rendah'
      );
    }

    if (record.attendance === 'Tinggi') {
      notes.push(
        'kehadiran siswa berada pada kategori tinggi'
      );
    }

    const detail = notes.length
      ? notes.join(', ')
      : 'atribut sosial dan pendidikan yang dimasukkan';

    return status === 'Layak'
      ? `Model C4.5 mengklasifikasikan siswa sebagai Layak berdasarkan pola pada dataset. Beberapa atribut yang tercatat: ${detail}.`
      : `Model C4.5 mengklasifikasikan siswa sebagai Tidak Layak berdasarkan pola pada dataset dan kombinasi atribut yang dimasukkan (${detail}).`;
  }

  // PROSES SIMPAN DAN KLASIFIKASI DATA
  function handleStudentSubmit(event) {
    event.preventDefault();

    const form = event.target;

    if (
      !(form instanceof HTMLFormElement) ||
      form.id !== 'studentForm'
    ) {
      notify(
        'Formulir data siswa tidak ditemukan. Silakan muat ulang halaman.',
        'error'
      );
      return;
    }

    if (!form.reportValidity()) {
      return;
    }

    try {
      const formData = new FormData(form);

      const record = {
        id: state.editingId
          ? Number(state.editingId)
          : getNextId(),

        name: String(
          formData.get('name') || ''
        ).trim(),

        school: String(
          formData.get('school') || ''
        ).trim(),

        siblings: String(
          formData.get('siblings') || ''
        ).trim(),

        fatherJob: String(
          formData.get('fatherJob') || ''
        ).trim(),

        fatherEdu: String(
          formData.get('fatherEdu') || ''
        ).trim(),

        motherJob: String(
          formData.get('motherJob') || ''
        ).trim(),

        motherEdu: String(
          formData.get('motherEdu') || ''
        ).trim(),

        pip: String(
          formData.get('pip') || ''
        ).trim(),

        parents: String(
          formData.get('parents') || ''
        ).trim(),

        attendance: String(
          formData.get('attendance') || ''
        ).trim(),

        updatedAt: new Date().toISOString()
      };

      const requiredFields = [
        ['Nama Siswa', record.name],
        ['Pendidikan Siswa', record.school],
        ['Jumlah Saudara', record.siblings],
        ['Pekerjaan Ayah', record.fatherJob],
        ['Pendidikan Ayah', record.fatherEdu],
        ['Pekerjaan Ibu', record.motherJob],
        ['Pendidikan Ibu', record.motherEdu],
        ['Penerima PIP', record.pip],
        ['Status Orang Tua', record.parents],
        ['Kehadiran Siswa', record.attendance]
      ];

      const missing = requiredFields.find(
        ([, value]) => !value
      );

      if (missing) {
        notify(
          `${missing[0]} wajib diisi.`,
          'error'
        );
        return;
      }

      // Periksa ketersediaan model C4.5.
      if (
        !window.C45 ||
        typeof window.C45.encodeRecord !== 'function' ||
        typeof window.C45.predictTree !== 'function' ||
        !state.model?.tree
      ) {
        throw new Error(
          'Model C4.5 tidak ditemukan. Pastikan file js/c45.js dan js/model-data.js berhasil dimuat.'
        );
      }

      // Jalankan encoding atribut.
      const encoded = window.C45.encodeRecord(record);

      // Jalankan prediksi menggunakan pohon keputusan C4.5.
      const predicted = window.C45.predictTree(
        state.model.tree,
        encoded,
        Number(state.model.majority_class_global ?? 1)
      );

      if (
        Number(predicted) !== 0 &&
        Number(predicted) !== 1
      ) {
        throw new Error(
          'Model C4.5 mengembalikan hasil prediksi yang tidak dikenali.'
        );
      }

      // Tentukan hasil klasifikasi.
      record.status = Number(predicted) === 1
        ? 'Layak'
        : 'Tidak Layak';

      record.description = explainPrediction(
        record,
        record.status
      );

      // Data disimpan sebelum state diperbarui.
      const updatedRecords = state.records.slice();

      if (
        state.editingId !== null &&
        state.editingId !== undefined
      ) {
        const index = updatedRecords.findIndex(
          item =>
            Number(item.id) === Number(state.editingId)
        );

        if (index < 0) {
          throw new Error(
            'Data yang akan diperbarui tidak ditemukan. Muat ulang daftar klasifikasi lalu coba lagi.'
          );
        }

        updatedRecords[index] = {
          ...updatedRecords[index],
          ...record
        };

      } else {
        updatedRecords.push(record);
      }

      // SIMPAN DATA.
      saveRecords(updatedRecords);

      state.records = updatedRecords;

      // Simpan hasil klasifikasi terakhir.
      state.lastResult = record;

      localStorage.setItem(
        STORAGE.lastResult,
        JSON.stringify(record)
      );

      state.editingId = null;
      state.page = 'result';
      state.search = '';
      state.currentPage = 1;

      updateTopbar();
      renderPage();

      notify(
        'Data berhasil disimpan dan diklasifikasikan.'
      );

    } catch (error) {
      console.error(
        'Gagal menyimpan atau mengklasifikasikan data siswa:',
        error
      );

      notify(
        error?.message ||
        'Terjadi kesalahan saat menyimpan dan mengklasifikasikan data.',
        'error'
      );
    }
  }

  // HALAMAN HASIL KLASIFIKASI
  function renderResultPage() {
    const record = state.lastResult ||
      safeParse(
        localStorage.getItem(STORAGE.lastResult),
        null
      );

    if (!record) {
      return `
        <div class="card card-padding empty-state">
          <strong>Belum ada hasil klasifikasi</strong>
          Silakan masukkan data siswa terlebih dahulu.
          <br><br>
          <button class="button button-primary" data-action="add-record">Tambah Data Siswa</button>
        </div>
      `;
    }

    const eligible = record.status === 'Layak';

    const details = [
      ['Nama Siswa', record.name],
      ['Pendidikan Siswa', record.school],
      ['Jumlah Saudara Sekolah', record.siblings],
      ['Pekerjaan Ayah', record.fatherJob],
      ['Pendidikan Akhir Ayah', record.fatherEdu],
      ['Pekerjaan Ibu', record.motherJob],
      ['Pendidikan Akhir Ibu', record.motherEdu],
      ['Penerima PIP', record.pip],
      ['Status Orang Tua', record.parents],
      ['Kehadiran Siswa', record.attendance]
    ];

    return `
      <div class="result-layout">
        <div class="page-heading">
          <div>
            <h2>Hasil Prediksi Klasifikasi</h2>
            <p>Data berhasil disimpan ke penyimpanan lokal browser.</p>
          </div>
        </div>
        <article class="card result-hero">
          <div class="result-symbol ${eligible ? '' : 'danger'}">${eligible ? '✓' : '!'}</div>
          <h2>HASIL PREDIKSI MODEL C4.5</h2>
          <div class="result-status ${eligible ? 'layak' : 'tidak-layak'}">${escapeHtml(record.status).toUpperCase()}</div>
          <p class="result-description">${escapeHtml(record.description || explainPrediction(record, record.status))}</p>
        </article>
        <article class="card card-padding" style="margin-top:16px">
          <div class="card-heading">
            <div>
              <h3>Detail Data Siswa</h3>
              <p>Rincian atribut yang menjadi masukan model.</p>
            </div>
          </div>
          <div class="detail-grid">${details.map(([label, value]) => `
              <div class="detail-item">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
              </div>
            `).join('')}
          </div>
          <div class="warning-note">Hasil ini merupakan keluaran model berdasarkan dataset pelatihan. Keputusan bantuan tetap perlu diverifikasi dan ditetapkan oleh pihak berwenang.</div>
        </article>
        <div class="result-actions">
          <button class="button button-secondary" data-page="records">← Kembali ke Klasifikasi</button>
          <button class="button button-primary" data-action="add-record">＋ Klasifikasi Data Baru</button>
        </div>
      </div>`;
  }

  // EVALUASI MODEL
  function metricsFrom(model) {
    const report =
      model && model.metrics
        ? model.metrics
        : {};

    const cm =
      report.confusion_matrix || [
        [0, 0],
        [0, 0]
      ];

    const tn = Number(cm?.[0]?.[0] || 0);
    const fp = Number(cm?.[0]?.[1] || 0);
    const fn = Number(cm?.[1]?.[0] || 0);
    const tp = Number(cm?.[1]?.[1] || 0);

    return {
      accuracy: Number(report.accuracy || 0),
      precision: Number(report.precision || 0),
      recall: Number(report.recall || 0),
      f1: Number(report.f1_score || 0),
      tn, fp, fn, tp,
      total: tn + fp + fn + tp,
      report
    };
  }

  function renderAccuracyPage() {
    const metrics = metricsFrom(state.model);
    const trainingRows = 150;

    const statusCount = {
      'Layak': 81,
      'Tidak Layak': 69
    };

    const modelRoot =
      state.model?.tree?.feature || 'Tidak tersedia';

    return `
      <div class="page-heading">
        <div>
          <h2>Evaluasi Model C4.5</h2>
          <p>Metrik evaluasi, confusion matrix, dan informasi model klasifikasi.</p>
        </div>
        <span class="status-badge layak">Model C4.5 bawaan</span>
      </div>
      <div class="metrics-grid">
        <article class="card metric-card">
          <p>Accuracy</p>
          <strong>${formatPercent(metrics.accuracy)}</strong>
          <small>Ketepatan keseluruhan</small>
        </article>
        <article class="card metric-card">
          <p>Precision</p>
          <strong>${formatPercent(metrics.precision)}</strong>
          <small>Prediksi Layak yang benar</small>
        </article>
        <article class="card metric-card">
          <p>Recall</p>
          <strong>${formatPercent(metrics.recall)}</strong>
          <small>Data Layak yang terdeteksi</small>
        </article>
        <article class="card metric-card">
          <p>F1-Score</p>
          <strong>${formatPercent(metrics.f1)}</strong>
          <small>Harmonik precision dan recall</small>
        </article>
        <article class="card metric-card">
          <p>Jumlah Data Uji</p>
          <strong>${formatNumber(metrics.total)}</strong>
          <small>Akumulasi confusion matrix</small>
        </article>
      </div>
      <div class="metrics-columns">
        <article class="card card-padding">
          <div class="card-heading">
            <div>
              <h3>Confusion Matrix</h3>
              <p>Baris menunjukkan kelas aktual, kolom menunjukkan hasil prediksi.</p>
            </div>
          </div>
          <div class="table-scroll">
            <table class="matrix">
              <thead>
                <tr>
                  <th></th>
                  <th>Pred. Tidak Layak</th>
                  <th>Pred. Layak</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Aktual Tidak Layak</th>
                  <td class="cell-good">${metrics.tn}</td>
                  <td class="cell-bad">${metrics.fp}</td>
                </tr>
                <tr>
                  <th>Aktual Layak</th>
                  <td class="cell-bad">${metrics.fn}</td>
                  <td class="cell-good">${metrics.tp}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="legend">
            <span>Prediksi benar</span>
            <span>Prediksi salah</span>
          </div>
          <div class="metric-note">
            <strong>TP:</strong> ${metrics.tp} ·
            <strong>TN:</strong> ${metrics.tn} ·
            <strong>FP:</strong> ${metrics.fp} ·
            <strong>FN:</strong> ${metrics.fn}
          </div>
        </article>
        <article class="card card-padding">
          <div class="card-heading">
            <div>
              <h3>Informasi Dataset</h3>
              <p>Dataset pelatihan yang disertakan pada ZIP.</p>
            </div>
          </div>
          <div class="detail-item">
            <span>Jumlah data CSV</span>
            <strong>${formatNumber(trainingRows)}</strong>
          </div>
          <div class="detail-item">
            <span>Label Layak</span>
            <strong>${formatNumber(statusCount['Layak'])}</strong>
          </div>
          <div class="detail-item">
            <span>Label Tidak Layak</span>
            <strong>${formatNumber(statusCount['Tidak Layak'])}</strong>
          </div>
          <div class="detail-item">
            <span>Jumlah fitur</span>
            <strong>8 atribut</strong>
          </div>
          <div class="detail-item">
            <span>Atribut akar pohon saat ini</span>
            <strong>${escapeHtml(modelRoot)}</strong>
          </div>
          <div class="metric-note">
            <p>Model melakukan klasifikasi berdasarkan delapan atribut siswa. Kolom identitas dan jenjang sekolah tidak digunakan sebagai fitur prediksi.</p>
          </div>
        </article>
      </div>
      <div class="metric-note" style="margin-top:17px">
        <strong>Catatan evaluasi:</strong>metrik yang ditampilkan berasal dari laporan model bawaan pada ZIP. CSV yang disertakan berisi 150 data pelatihan dengan 81 label Layak dan 69 label Tidak Layak.</div>`;
  }

  // PENGATURAN AKUN
  function renderSettingsPage() {
    const account = safeParse(
      localStorage.getItem(STORAGE.account),
      { username: 'admin123' }
    );

    return `
      <div class="settings-grid" style="justify-content: center;">
        <article class="card settings-card">
          <h2>Edit Akun</h2>
          <p>Memperbarui Akun Administrator Bansos Username dan Password.</p>
          <form id="accountForm" class="form-stack">
            <div class="field-group">
              <input id="settingUsername" name="username" type="text" value="${escapeHtml(account.username)}" autocomplete="username" required>
            </div>
            <div class="field-group">
              <label for="settingCurrentPassword">Password saat ini</label>
              <input id="settingCurrentPassword" name="currentPassword" type="password" autocomplete="current-password" required>
            </div>
            <div class="field-group">
              <label for="settingNewPassword">Password baru
                <span class="optional-label">(opsional)</span>
              </label>
              <input id="settingNewPassword" name="newPassword" type="password" minlength="6" autocomplete="new-password" placeholder="Kosongkan jika tidak ingin mengganti">
            </div>
            <div class="field-group">
              <label for="settingConfirmPassword">Konfirmasi password baru</label>
              <input id="settingConfirmPassword" name="confirmPassword" type="password" minlength="6" autocomplete="new-password" placeholder="Ulangi password baru">
            </div>
            <p id="accountError" class="form-error hidden" role="alert"></p>
            <button class="button button-primary" type="submit">Simpan Perubahan</button>
          </form>
        </article>
      </div>
      <div class="data-warning" style="margin-top:17px">
        <strong>Catatan:</strong>
        aplikasi HTML/CSS/JavaScript ini menyimpan akun dan data pada browser/perangkat yang digunakan. Login lokal bukan autentikasi server untuk penggunaan publik atau multiuser.
      </div>`;
  }

  // ID DATA DAN MODAL KONFIRMASI
  function getNextId() {
    return state.records.reduce(
      (max, record) =>
        Math.max(max, Number(record.id) || 0),
      0
    ) + 1;
  }

  function openConfirm(
    title, message, confirmLabel, callback
  ) {
    $('#modalRoot').innerHTML = `
      <div class="modal-backdrop" role="presentation">
        <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
          <div class="modal-icon">!</div>
          <h3 id="modalTitle">${escapeHtml(title)}</h3>
          <p>${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button class="button button-secondary" data-modal-cancel>Batal</button>
            <button class="button button-danger" data-modal-confirm>${escapeHtml(confirmLabel)}</button>
          </div>
        </section>
      </div>`;

    $('[data-modal-cancel]').addEventListener(
      'click',
      () => {$('#modalRoot').innerHTML = '';}
    );

    $('[data-modal-confirm]').addEventListener(
      'click',
      () => {
        $('#modalRoot').innerHTML = '';
        callback();
      }
    );

    $('.modal-backdrop').addEventListener(
      'click',
      event => {
        if (
          event.target.classList.contains('modal-backdrop')
        ) {
          $('#modalRoot').innerHTML = '';
        }
      }
    );
  }

  // EKSPOR DATA CSV
  function downloadBlob(
    content, filename, mimeType
  ) {
    const blob = new Blob(
      [content], { type: mimeType }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;

    document.body.appendChild(anchor);

    anchor.click();
    anchor.remove();

    setTimeout(
      () => URL.revokeObjectURL(url),
      1000
    );
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const headers = [
      'No',
      'Nama Siswa',
      'Pendidikan Siswa',
      'Jumlah Saudara Sekolah',
      'Pekerjaan Ayah',
      'Pendidikan Akhir Ayah',
      'Pekerjaan Ibu',
      'Pendidikan Akhir Ibu',
      'Penerima PIP',
      'Status Orang Tua',
      'Kehadiran Siswa',
      'Status'
    ];

    const keys = [
      'id',
      'name',
      'school',
      'siblings',
      'fatherJob',
      'fatherEdu',
      'motherJob',
      'motherEdu',
      'pip',
      'parents',
      'attendance',
      'status'
    ];

    const rows = state.records.map(record =>
      keys.map(key => csvCell(record[key])).join(',')
    );

    const csv = '\uFEFF' + [
      headers.map(csvCell).join(','),
      ...rows
    ].join('\r\n');

    downloadBlob(
      csv,
      `rekap-klasifikasi-bansos-c45-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8;'
    );

    notify('File CSV berhasil disiapkan.');
  }

  // PROSES EDIT AKUN
  async function handleAccountSubmit(event) {
    event.preventDefault();

    const form = event.target;

    if (
      !(form instanceof HTMLFormElement) ||
      form.id !== 'accountForm'
    ) {
      notify('Formulir Edit Akun tidak ditemukan. Silakan muat ulang halaman.', 'error');
      return;
    }

    const error = $('#accountError', form);

    const submitButton = $(
      'button[type="submit"]',
      form
    );

    const originalButtonText =
      submitButton.textContent;

    error.classList.add('hidden');

    submitButton.disabled = true;
    submitButton.textContent = 'Menyimpan...';

    try {
      const values = new FormData(form);

      const account = safeParse(
        localStorage.getItem(STORAGE.account),
        null
      );

      const username = String(
        values.get('username') || ''
      ).trim();

      const currentPassword = String(
        values.get('currentPassword') || ''
      );

      const newPassword = String(
        values.get('newPassword') || ''
      );

      const confirmPassword = String(
        values.get('confirmPassword') || ''
      );

      if (
        !account ||
        await passwordDigest(currentPassword) !==
          account.passwordDigest
      ) {
        throw new Error(
          'Password saat ini tidak sesuai.'
        );
      }

      if (!username) {
        throw new Error(
          'Username tidak boleh kosong.'
        );
      }

      let digest = account.passwordDigest;

      if (newPassword || confirmPassword) {
        if (newPassword.length < 6) {
          throw new Error(
            'Password baru minimal terdiri dari 6 karakter.'
          );
        }

        if (newPassword !== confirmPassword) {
          throw new Error(
            'Konfirmasi password baru tidak sama.'
          );
        }

        digest = await passwordDigest(newPassword);
      }

      localStorage.setItem(
        STORAGE.account,
        JSON.stringify({
          username,
          passwordDigest: digest
        })
      );

      updateTopbar();
      renderPage();

      notify('Akun administrator berhasil diperbarui.');

    } catch (submitError) {
      error.textContent =
        submitError?.message ||
        'Perubahan akun gagal disimpan. Coba kembali.';

      error.classList.remove('hidden');

      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;

      console.error(
        'Gagal memperbarui akun administrator:',
        submitError
      );
    }
  }

  // EVENT KLIK
  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-page]');

    if (nav) {
      event.preventDefault();
      enterPage(nav.dataset.page);
      return;
    }

    const action = event.target.closest('[data-action]');

    if (!action) {
      return;
    }

    const type = action.dataset.action;

    // TAMBAH DATA
    if (type === 'add-record') {
      state.editingId = null;
      enterPage('form');
    }

    // EDIT DATA
    else if (type === 'edit') {
      state.editingId = Number(action.dataset.id);
      enterPage('form');
    }

    // HAPUS DATA
    else if (type === 'delete') {
      const id = Number(action.dataset.id);

      const record = state.records.find(
        item => Number(item.id) === id
      );

      openConfirm(
        'Hapus data siswa?',
        `Data ${
          record?.name || 'siswa ini'
        } akan dihapus dari penyimpanan browser. Tindakan ini tidak dapat dibatalkan.`,
        'Ya, Hapus',
        () => {

          try {

            const updatedRecords =
              state.records.filter(
                item => Number(item.id) !== id
              );

            // Simpan hasil penghapusan.
            saveRecords(updatedRecords);

            // Update data aplikasi.
            state.records = updatedRecords;

            renderPage();

            notify('Data berhasil dihapus.');

          } catch (error) {

            console.error(
              'Gagal menghapus data siswa:',
              error
            );

            notify(
              error?.message || 'Data gagal dihapus.',
              'error'
            );
          }
        }
      );
    }

    // PAGINATION
    else if (type === 'page') {
      state.currentPage =
        Number(action.dataset.pageNumber) || 1;

      renderPage();
    }

    // EKSPOR CSV
    else if (type === 'export-csv') {
      exportCsv();
    }
  });

  // EVENT SUBMIT FORM
  document.addEventListener('submit', event => {
    if (event.target.id === 'studentForm') {
      handleStudentSubmit(event);
    }

    if (event.target.id === 'accountForm') {
      handleAccountSubmit(event);
    }
  });

  // EVENT PENCARIAN DATA
  document.addEventListener('input', event => {
    if (event.target.id === 'recordSearch') {

      state.search = event.target.value;
      state.currentPage = 1;

      const cursor = event.target.selectionStart;

      renderPage();

      const newSearch = $('#recordSearch');

      newSearch.focus();
      newSearch.setSelectionRange(cursor, cursor);
    }
  });

  // EVENT LOGIN
  $('#authForm').addEventListener(
    'submit',
    handleAuthSubmit
  );

  $('#authBackLink').addEventListener(
    'click',
    event => {

      if (window.history.length > 1) {
        event.preventDefault();
        window.history.back();
      }

    }
  );

  // LOGOUT
  $('#logoutButton').addEventListener(
    'click',
    () => {

      sessionStorage.removeItem(
        'bansos_c45_logged_in'
      );

      showAuth();

      notify(
        'Anda telah keluar dari aplikasi.'
      );

    }
  );

  
  // INISIALISASI APLIKASI
  async function init() {

    // Ambil data klasifikasi.
    loadRecords();

    // Ambil model C4.5.
    loadModel();

    // KONFIGURASI AKUN ADMINISTRATOR
    const DEFAULT_USERNAME = 'admin123';
    const DEFAULT_PASSWORD = '123admin';

    let account = safeParse(
      localStorage.getItem(STORAGE.account),
      null
    );

    const newPasswordDigest =
      await passwordDigest(DEFAULT_PASSWORD);

    // Deteksi akun bawaan lama admin / 123456.
    const oldPasswordDigest =
      await passwordDigest('123456');

    // Deteksi akun yang dibuat dari revisi sebelumnya:
    // admin123 / admin123.
    const previousPasswordDigest =
      await passwordDigest('admin123');

    const oldDefaultAccount = Boolean(
      account &&
      account.username === 'admin' &&
      (
        account.passwordDigest === oldPasswordDigest ||
        account.passwordDigest === 'local:MTIzNDU2'
      )
    );

    const previousRevisionAccount = Boolean(
      account &&
      account.username === 'admin123' &&
      account.passwordDigest === previousPasswordDigest
    );

    const invalidAccount = Boolean(
      !account ||
      !account.username ||
      !account.passwordDigest
    );

    // Buat akun baru atau perbarui akun bawaan.
    // Akun yang sudah diubah melalui menu Edit Akun
    // tidak akan ditimpa.
    if (
      invalidAccount ||
      oldDefaultAccount ||
      previousRevisionAccount
    ) {

      account = {
        username: DEFAULT_USERNAME,
        passwordDigest: newPasswordDigest
      };

      localStorage.setItem(
        STORAGE.account,
        JSON.stringify(account)
      );

      // Hapus sesi login agar pengguna login ulang.
      sessionStorage.removeItem(
        'bansos_c45_logged_in'
      );
    }

    updateTopbar();

    // Periksa status login.
    if (
      sessionStorage.getItem('bansos_c45_logged_in') === '1'
    ) {
      enterApp();
    } else {
      showAuth();
    }
  }

  // Jalankan inisialisasi.
  init().catch(error => {

    console.error(
      'Gagal menginisialisasi BANSOS C4.5:',
      error
    );

    showAuth();

    notify(
      'Aplikasi gagal diinisialisasi. Periksa pengaturan penyimpanan browser.',
      'error'
    );
  });
})();