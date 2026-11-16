/*
 * Sharfo static edition
 * PHP/MySQL workflows are reproduced in the browser with localStorage.
 * This is a front-end demo: data is stored in the current browser only.
 */
(() => {
  'use strict';

  const DB_KEY = 'sharfo_static_database_v2';
  const SLIDER_IMAGES = [
    'assets/slider/Beach_midday.jpg',
    'assets/slider/Forest_afternoon.jpg',
    'assets/slider/Mountain_assiniboine_light.jpg',
    'assets/slider/Panorama_Meransen.jpg',
    'assets/slider/Sea_night.jpg',
    'assets/slider/Westminster_Big_Ben.jpg'
  ];

  let db = loadDatabase();
  let activeSlide = 0;
  let sliderTimer = null;
  let toastTimer = null;
  let currentTablePage = 1;
  let pendingConfirm = null;
  let homeSearch = '';
  let tableSearch = '';

  // Kredensial admin diambil dari seed dalam bentuk hash PBKDF2, bukan password asli.
  // Migrasi ini juga memperbarui data localStorage versi sebelumnya yang masih menyimpan
  // password admin sebagai teks biasa. Akun pengguna biasa tidak disentuh.
  function applyAdminCredentialMigration(database) {
    database.users = Array.isArray(database.users) ? database.users : [];
    const seedAdmin = (window.SHARFO_SEED?.users || []).find(user =>
      (String(user.username || '').trim().toLowerCase() === 'admin123' || String(user.username || '').trim().toLowerCase() === 'admin' || user.role === 'admin')
    );

    if (!seedAdmin) return database;

    // Cari akun admin tanpa bergantung pada properti role/passwordSalt lama.
    // Ini memulihkan data localStorage yang salt-nya pernah rusak atau terubah.
    let admin = database.users.find(user =>
      (String(user.username || '').trim().toLowerCase() === 'admin123' || String(user.username || '').trim().toLowerCase() === 'admin' || user.role === 'admin')
    );

    if (!admin) {
      admin = { ...seedAdmin };
      database.users.unshift(admin);
    }

    const needsUpdate = admin.username !== seedAdmin.username ||
      admin.role !== 'admin' ||
      admin.passwordAlgorithm !== seedAdmin.passwordAlgorithm ||
      admin.passwordIterations !== seedAdmin.passwordIterations ||
      admin.passwordSalt !== seedAdmin.passwordSalt ||
      admin.passwordHash !== seedAdmin.passwordHash ||
      admin.password !== undefined;

    if (needsUpdate) {
      admin.username = seedAdmin.username;
      admin.role = 'admin';
      admin.passwordAlgorithm = seedAdmin.passwordAlgorithm;
      admin.passwordIterations = seedAdmin.passwordIterations;
      admin.passwordSalt = seedAdmin.passwordSalt;
      admin.passwordHash = seedAdmin.passwordHash;
      delete admin.password;

      // Jika sesi lama adalah admin, minta login kembali hanya saat kredensial berubah.
      if (database.sessionUserId === admin.id) database.sessionUserId = null;
    }
    return database;
  }

  function loadDatabase() {
    try {
      const saved = localStorage.getItem(DB_KEY);
      if (saved) {
        const loaded = applyAdminCredentialMigration(JSON.parse(saved));
        localStorage.setItem(DB_KEY, JSON.stringify(loaded));
        return loaded;
      }
    } catch (error) {
      console.warn('Data Sharfo tidak dapat dibaca, memuat data awal.', error);
    }
    const fresh = applyAdminCredentialMigration(
      JSON.parse(JSON.stringify(window.SHARFO_SEED || { users: [], photos: [], follows: [] }))
    );
    fresh.sessionUserId = null;
    localStorage.setItem(DB_KEY, JSON.stringify(fresh));
    return fresh;
  }

  function saveDatabase() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      return true;
    } catch (error) {
      showToast('Penyimpanan browser penuh. Coba gunakan foto berukuran lebih kecil.');
      console.error(error);
      return false;
    }
  }

  function resetDatabase() {
    localStorage.removeItem(DB_KEY);
    db = applyAdminCredentialMigration(
      JSON.parse(JSON.stringify(window.SHARFO_SEED || { users: [], photos: [], follows: [] }))
    );
    db.sessionUserId = null;
    saveDatabase();
    currentTablePage = 1;
    homeSearch = '';
    tableSearch = '';
    go('/home');
    showToast('Data contoh berhasil dipulihkan.');
  }

  function currentUser() {
    return db.users.find(user => user.id === db.sessionUserId) || null;
  }

  function nextId(collection) {
    return Math.max(0, ...collection.map(item => Number(item.id) || 0)) + 1;
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function niceDate(value) {
    if (!value) return '-';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function go(path) {
    stopSlider();
    if (location.hash === `#${path}`) render();
    else location.hash = `#${path}`;
  }

  function routePath() {
    return decodeURIComponent((location.hash || '#/home').slice(1).split('?')[0] || '/home');
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function showConfirm(title, message, actionLabel, callback) {
    pendingConfirm = callback;
    document.getElementById('modal-root').innerHTML = `
      <div class="modal-backdrop" data-action="modal-backdrop">
        <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
          <h3 id="confirmTitle">${escapeHTML(title)}</h3>
          <p>${escapeHTML(message)}</p>
          <div class="modal-actions">
            <button class="btn-secondary" type="button" data-action="close-modal">Batal</button>
            <button class="btn-primary" type="button" data-action="confirm-modal">${escapeHTML(actionLabel || 'Ya, lanjutkan')}</button>
          </div>
        </section>
      </div>`;
  }

  function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
    pendingConfirm = null;
  }

  function goLoginForPhoto(id) {
    sessionStorage.setItem('sharfo-after-login', `/photo/${id}`);
    go('/login');
  }

  function photoById(id) {
    return db.photos.find(photo => photo.id === Number(id));
  }

  function ownerOf(photo) {
    if (photo.userId === null || photo.userId === undefined) return null;
    return db.users.find(user => user.id === photo.userId) || null;
  }

  function isFollowing(photoId, userId = db.sessionUserId) {
    return db.follows.some(item => item.userId === userId && item.photoId === Number(photoId));
  }

  function followCount(photoId) {
    return db.follows.filter(item => item.photoId === Number(photoId)).length;
  }

  function followPhoto(photoId) {
    const user = currentUser();
    if (!user) return goLoginForPhoto(photoId);
    const index = db.follows.findIndex(item => item.userId === user.id && item.photoId === Number(photoId));
    if (index >= 0) {
      db.follows.splice(index, 1);
      saveDatabase();
      showToast('Foto dihapus dari daftar Ikuti.');
    } else {
      db.follows.push({ userId: user.id, photoId: Number(photoId) });
      saveDatabase();
      showToast('Foto berhasil ditambahkan ke daftar Ikuti.');
    }
    render();
  }

  function renderHeader(user, route) {
    if (!user) {
      return `
        <header class="header"><nav class="navbar">
          <a class="nav-item brand" href="#/home">Sharfo</a>
          <a class="nav-item ${route === '/followed' ? 'active' : ''}" href="#/login">♡&nbsp; Ikuti</a>
          <a class="nav-item ${route === '/account' ? 'active' : ''}" href="#/login">⚙&nbsp; Akun</a>
          <a class="nav-item" href="../index.html">Kembali</a>
        </nav></header>`;
    }

    const managementArea = route === '/account' || route === '/my-photos' || route.startsWith('/admin/') || route.startsWith('/photo-form') || route.startsWith('/user-form');
    if (user.role === 'admin' && managementArea) {
      return `
        <header class="adminheader"><nav class="adminnavbar">
          <a class="nav-item brand" href="#/home">Sharfo</a>
          <a class="nav-item ${route.startsWith('/admin/users') || route.startsWith('/user-form') ? 'active' : ''}" href="#/admin/users">♙&nbsp; Data Akun User</a>
          <a class="nav-item ${route.startsWith('/admin/photos') || route.startsWith('/photo-form') ? 'active' : ''}" href="#/admin/photos">▧&nbsp; Data Foto</a>
          <a class="nav-item ${route === '/account' ? 'active' : ''}" href="#/account">⚙&nbsp; Akun</a>
        </nav></header>`;
    }
    if (user.role === 'user' && managementArea) {
      return `
        <header class="adminheader"><nav class="adminnavbar">
          <a class="nav-item brand" href="#/home">Sharfo</a>
          <a class="nav-item ${route === '/my-photos' || route.startsWith('/photo-form') ? 'active' : ''}" href="#/my-photos">▧&nbsp; Data Foto</a>
          <a class="nav-item ${route === '/account' ? 'active' : ''}" href="#/account">⚙&nbsp; Akun</a>
        </nav></header>`;
    }

    return `
      <header class="header"><nav class="navbar">
        <a class="nav-item brand" href="#/home">Sharfo</a>
        <div class="header-search"><input type="search" id="headerSearch" data-search-home autocomplete="off" placeholder="Masukkan Nama Foto . . ." value="${escapeHTML(homeSearch)}"></div>
        <a class="nav-item ${route === '/followed' ? 'active' : ''}" href="#/followed">♡&nbsp; Ikuti</a>
        <a class="nav-item ${route === '/account' ? 'active' : ''}" href="#/account">⚙&nbsp; Akun</a>
      </nav></header>`;
  }

  function renderFooter() {
    return `
      <footer class="footer">
        <hr class="view_batas">
        <div class="akun_container"><div class="footer-row">
          <div class="footer-col"><h4>Informasi</h4><ul><li><button type="button" data-info="about">Tentang Kami</button></li></ul></div>
          <div class="footer-col"><h4>Layanan Pengunjung</h4><ul>
            <li><button type="button" data-info="address">Alamat Kami</button></li>
            <li><button type="button" data-info="register">Bagaimana Cara Daftar Akun</button></li>
            <li><button type="button" data-info="login">Bagaimana Cara Masuk Akun</button></li>
          </ul></div>
          <div class="footer-col"><h4>Ikuti Kami</h4><div class="social-links">
            <a href="https://www.facebook.com/" target="_blank" rel="noopener" aria-label="Facebook">f</a>
            <a href="https://www.twitter.com/" target="_blank" rel="noopener" aria-label="Twitter">𝕏</a>
            <a href="https://www.instagram.com/" target="_blank" rel="noopener" aria-label="Instagram">◎</a>
          </div></div>
        </div></div>
      </footer><h3 class="view_copyright">&copy; Sharfo 2024</h3>`;
  }

  function photoCard(photo, publicMode = false) {
    const owner = ownerOf(photo);
    const label = escapeHTML(photo.name);
    const meta = `${escapeHTML(photo.country)}${owner ? ` · ${escapeHTML(owner.username)}` : (photo.archiveOnly ? ' · data arsip' : '')}`;
    return `
      <a class="photo-card" href="#/photo/${photo.id}" data-photo-open="${photo.id}" aria-label="Lihat ${label}">
        <img class="photo-thumb" src="${escapeHTML(photo.image)}" alt="${label}" loading="lazy">
        <p class="photo-card-title">${label}</p>
        <span class="photo-card-meta">${meta}</span>
      </a>`;
  }

  function shuffle(items) {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function sliderMarkup() {
    return `
      <div class="slider" aria-label="Foto pilihan">
        <div class="slide-track" id="slideTrack">
          ${SLIDER_IMAGES.map((src, i) => `<div class="slide-item"><img src="${src}" alt="Pemandangan wisata ${i + 1}"></div>`).join('')}
        </div>
        <button class="slide-arrow prev" type="button" aria-label="Foto sebelumnya" data-action="prev-slide">&lt;</button>
        <button class="slide-arrow next" type="button" aria-label="Foto selanjutnya" data-action="next-slide">&gt;</button>
        <div class="slide-dots">${SLIDER_IMAGES.map((_, i) => `<button type="button" class="${i === activeSlide ? 'active' : ''}" aria-label="Slide ${i + 1}" data-slide="${i}"></button>`).join('')}</div>
      </div>`;
  }

  function homeGalleryMarkup() {
    const user = currentUser();
    let photos = db.photos;
    if (user && user.role === 'user' && homeSearch.trim()) {
      const term = homeSearch.toLowerCase();
      photos = photos.filter(photo => `${photo.name} ${photo.country} ${photo.description}`.toLowerCase().includes(term));
      return `<section class="all-photo"><div class="gallery-toolbar"><h2 class="section-heading">Hasil Pencarian Foto</h2><p>${photos.length} foto ditemukan</p></div><div class="all-photo-in gallery-grid">${photos.length ? photos.map(p => photoCard(p)).join('') : '<div class="empty-state">Tidak ada foto yang cocok dengan pencarian Anda.</div>'}</div></section>`;
    }
    const chosen = shuffle(photos).slice(0, 8);
    return `<section class="all-photo"><div class="all-photo-in">${chosen.length ? chosen.map(p => photoCard(p, !user)).join('') : '<div class="empty-state">Tidak ada foto yang ditemukan.</div>'}</div></section>`;
  }

  function renderHome(user) {
    return `${renderHeader(user, '/home')}<main class="home-wrap">${sliderMarkup()}${homeGalleryMarkup()}</main>${renderFooter()}`;
  }

  function renderLogin() {
    return `${renderHeader(null, '/login')}
      <main class="log-body"><section class="container">
        <form class="log-form" data-form="login">
          <header>Sharfo Masuk</header><br><br>
          <div class="input-box"><label for="loginUsername">Username</label><input type="text" id="loginUsername" name="username" placeholder="Masukkan Username" autocomplete="username" required autofocus></div>
          <div class="input-box"><label for="loginPassword">Password</label><input type="password" id="loginPassword" name="password" placeholder="Masukkan Password" autocomplete="current-password" required></div>
          <div class="all-butbox"><button class="butbox" type="submit">Masuk</button><a class="butbox" href="#/register">Daftar</a></div>
        </form>
      </section></main>${renderFooter()}`;
  }

  function renderRegister() {
    return `${renderHeader(null, '/register')}
      <main class="log-body"><section class="container">
        <form class="log-form" data-form="register">
          <header>Sharfo Daftar</header><br><br>
          <div class="input-box"><label for="regUsername">Username</label><input type="text" name="username" id="regUsername" placeholder="Masukkan Username" maxlength="32" required></div>
          <div class="input-box"><label for="regName">Nama User</label><input type="text" name="name" id="regName" placeholder="Masukkan Nama User" maxlength="60" required></div>
          <div class="gender-box"><h3>Gender</h3><div class="gender-option">
            <label class="gender"><input type="radio" name="gender" value="pria" checked> Pria</label>
            <label class="gender"><input type="radio" name="gender" value="perempuan"> Perempuan</label>
          </div></div>
          <div class="input-box"><label for="regAge">Umur</label><input type="number" name="age" id="regAge" min="10" max="120" placeholder="Masukkan Umur" required></div>
          <div class="input-box"><label for="regPassword">Password</label><input type="password" name="password" id="regPassword" placeholder="Masukkan Password" minlength="4" required></div>
          <div class="input-box"><label for="regConfirm">Konfirmasi Password</label><input type="password" name="confirm" id="regConfirm" placeholder="Masukkan Password Lagi" minlength="4" required></div>
          <div class="all-butbox"><button class="butbox" type="submit">Daftar</button><a class="butbox" href="#/login">Masuk</a></div>
        </form>
      </section></main>${renderFooter()}`;
  }

  function renderPhotoDetail(user, id) {
    const photo = photoById(id);
    if (!photo) return `${renderHeader(user, '')}<section class="info-page"><h1>Foto tidak ditemukan</h1><p>Foto yang Anda cari tidak tersedia.</p><p><a href="#/home">Kembali ke halaman utama</a></p></section>${renderFooter()}`;
    if (!user) return renderLogin();
    const owner = ownerOf(photo);
    const followed = isFollowing(photo.id, user.id);
    const canManage = user.role === 'admin' || photo.userId === user.id;
    return `${renderHeader(user, '/home')}
      <main>
        <section class="view_foto">
          <img src="${escapeHTML(photo.image)}" alt="${escapeHTML(photo.name)}">
          <div class="view_detail">
            <h2>${escapeHTML(photo.name)}</h2>
            <h3>${escapeHTML(photo.country)}</h3>
            <p class="detail-owner">${escapeHTML(owner ? owner.name : (photo.archiveOnly ? 'Pemilik belum tercatat di data sumber' : 'Pengguna Sharfo'))}</p>
            <p>${niceDate(photo.date)}</p>
            <p>♡ ${followCount(photo.id)} pengikut</p>
            <div class="detail-actions">
              <button class="akun_eksekusi_butbox" type="button" data-action="follow-photo" data-id="${photo.id}">${followed ? '♥ Sedang Diikuti' : '♡ Ikuti Foto'}</button>
              ${canManage ? `<a class="akun_butbox" href="#/photo-form/${photo.id}">✎ Edit Foto</a>` : ''}
              <a class="akun_butbox" href="#/home">Kembali</a>
            </div>
          </div>
        </section>
        <section class="detail-description"><h3>Deskripsi</h3><p>${escapeHTML(photo.description)}</p></section>
      </main>${renderFooter()}`;
  }

  function tablePagination(total, page, pageSize = 10) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const items = [];
    if (page > 1) items.push(`<button class="akun_butbox_page" data-page="1">« Pertama</button>`, `<button class="akun_butbox_page" data-page="${page - 1}">‹ Sebelumnya</button>`);
    for (let p = 1; p <= pages; p++) {
      if (pages > 7 && p > 2 && p < pages - 1 && Math.abs(p - page) > 1) {
        if (p === 3 || p === pages - 2) items.push('<span class="muted">…</span>');
        continue;
      }
      items.push(`<button class="akun_butbox_page ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`);
    }
    if (page < pages) items.push(`<button class="akun_butbox_page" data-page="${page + 1}">Selanjutnya ›</button>`, `<button class="akun_butbox_page" data-page="${pages}">Terakhir »</button>`);
    return `<div class="pagination">${items.join('')}</div>`;
  }

  function renderFollowed(user) {
    const keyword = tableSearch.toLowerCase().trim();
    let rows = db.follows.filter(item => item.userId === user.id).map(item => photoById(item.photoId)).filter(Boolean);
    if (keyword) rows = rows.filter(photo => `${photo.name} ${photo.country}`.toLowerCase().includes(keyword));
    const pageSize = 10;
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    currentTablePage = Math.min(currentTablePage, pages);
    const shown = rows.slice((currentTablePage - 1) * pageSize, currentTablePage * pageSize);
    return `${renderHeader(user, '/followed')}<main class="userbody"><section class="akun_isicontainer">
      <div class="akun-toolbar"><a class="akun_butbox" href="#/home">＋ Tambah</a><input class="akun_cari" type="search" data-filter-followed value="${escapeHTML(tableSearch)}" placeholder="Masukkan Nama Foto . . ." autocomplete="off"></div>
      <div class="table-wrap"><table class="akun_crud"><thead><tr><th>NO</th><th>USER</th><th>NAMA FOTO</th><th>NEGARA ASAL FOTO</th><th>TANGGAL FOTO</th><th>GAMBAR</th><th>AKSI</th></tr></thead><tbody>
        ${shown.length ? shown.map((photo, i) => { const owner = ownerOf(photo); return `<tr><td>${(currentTablePage - 1) * pageSize + i + 1}</td><td>${escapeHTML(owner ? owner.username : '-')}</td><td>${escapeHTML(photo.name)}</td><td>${escapeHTML(photo.country)}</td><td>${escapeHTML(photo.date)}</td><td><img class="table-photo" src="${escapeHTML(photo.image)}" alt=""></td><td><button class="akun_butbox danger" type="button" data-action="unfollow-photo" data-id="${photo.id}">♥ Hapus</button></td></tr>`; }).join('') : '<tr><td colspan="7">Tidak ada foto yang Anda ikuti.</td></tr>'}
      </tbody></table></div>${tablePagination(rows.length, currentTablePage, pageSize)}
    </section></main>${renderFooter()}`;
  }

  function renderPhotoTable(user, adminMode) {
    const keyword = tableSearch.toLowerCase().trim();
    let rows = adminMode ? db.photos.slice() : db.photos.filter(photo => photo.userId === user.id);
    if (keyword) rows = rows.filter(photo => {
      const owner = ownerOf(photo);
      return `${photo.name} ${photo.country} ${owner ? owner.username : ''}`.toLowerCase().includes(keyword);
    });
    const pageSize = 10;
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    currentTablePage = Math.min(currentTablePage, pages);
    const shown = rows.slice((currentTablePage - 1) * pageSize, currentTablePage * pageSize);
    const title = adminMode ? 'Data Foto' : 'CRUD FOTO User';
    const archiveCount = db.photos.filter(photo => photo.archiveOnly).length;
    const sourceCount = db.photos.filter(photo => photo.sourceRecord).length;
    const additionalCount = db.photos.length - sourceCount - archiveCount;
    const firstShown = rows.length ? ((currentTablePage - 1) * pageSize + 1) : 0;
    const lastShown = Math.min(currentTablePage * pageSize, rows.length);
    const additionalLabel = additionalCount ? ` Ditambah ${additionalCount} foto baru yang dikelola di browser.` : '';
    const adminInventory = adminMode ? `<div class="photo-list-info"><strong>${db.photos.length} foto tersedia</strong><span>${sourceCount} data foto dari tabel semfoto, ${archiveCount} file gambar arsip tanpa catatan aktif.${additionalLabel} Semua file unggahan dari ZIP sumber sudah disertakan.</span><small>Menampilkan ${firstShown}–${lastShown} dari ${rows.length} hasil${keyword ? ' pencarian' : ''}.</small></div>` : '';
    return `${renderHeader(user, adminMode ? '/admin/photos' : '/my-photos')}<main class="userbody"><section class="akun_isicontainer">
      <header>${title}</header><br>
      ${adminInventory}
      <div class="akun-toolbar"><a class="akun_butbox" href="#/photo-form/new">＋ Tambah</a><input class="akun_cari" type="search" data-filter-photos value="${escapeHTML(tableSearch)}" placeholder="Masukkan Pencarian User/ Nama Foto/ Negara Asal Foto . . ." autocomplete="off"></div>
      <div class="table-wrap"><table class="akun_crud"><thead><tr>${adminMode ? '<th>NO</th><th>USER</th>' : '<th>NO</th>'}<th>NAMA FOTO</th><th>NEGARA ASAL FOTO</th><th>TANGGAL FOTO</th><th>GAMBAR</th><th>ACTION</th></tr></thead><tbody>
      ${shown.length ? shown.map((photo, i) => { const owner = ownerOf(photo); return `<tr><td>${(currentTablePage - 1) * pageSize + i + 1}</td>${adminMode ? `<td>${escapeHTML(owner ? owner.username : '-')}</td>` : ''}<td>${escapeHTML(photo.name)}</td><td>${escapeHTML(photo.country)}</td><td>${escapeHTML(photo.date)}</td><td><img class="table-photo" src="${escapeHTML(photo.image)}" alt=""></td><td><a class="akun_butbox" href="#/photo-form/${photo.id}">✎ Edit</a><button class="akun_butbox danger" data-action="delete-photo" data-id="${photo.id}" type="button">▤ Hapus</button></td></tr>`; }).join('') : `<tr><td colspan="${adminMode ? 7 : 6}">Tidak ada foto yang ditemukan.</td></tr>`}
      </tbody></table></div>${tablePagination(rows.length, currentTablePage, pageSize)}
    </section></main>${renderFooter()}`;
  }

  function renderUserTable(user) {
    const keyword = tableSearch.toLowerCase().trim();
    let rows = db.users.filter(item => item.role === 'user');
    if (keyword) rows = rows.filter(item => `${item.username} ${item.name}`.toLowerCase().includes(keyword));
    const pageSize = 10;
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    currentTablePage = Math.min(currentTablePage, pages);
    const shown = rows.slice((currentTablePage - 1) * pageSize, currentTablePage * pageSize);
    return `${renderHeader(user, '/admin/users')}<main class="userbody"><section class="akun_isicontainer">
      <div class="akun-toolbar"><a class="akun_butbox" href="#/user-form/new">＋ Tambah</a><input class="akun_cari" type="search" data-filter-users value="${escapeHTML(tableSearch)}" placeholder="Masukkan Pencarian Username/ Nama . . ." autocomplete="off"></div>
      <div class="table-wrap"><table class="akun_crud"><thead><tr><th>NO</th><th>USERNAME</th><th>NAMA</th><th>GENDER</th><th>UMUR</th><th>ACTION</th></tr></thead><tbody>
      ${shown.length ? shown.map((item, i) => `<tr><td>${(currentTablePage - 1) * pageSize + i + 1}</td><td>${escapeHTML(item.username)}</td><td>${escapeHTML(item.name)}</td><td>${escapeHTML(item.gender)}</td><td>${item.age}</td><td><a class="akun_butbox" href="#/user-form/${item.id}">✎ Edit</a><button class="akun_butbox danger" type="button" data-action="delete-user" data-id="${item.id}">▤ Hapus</button></td></tr>`).join('') : '<tr><td colspan="6">Tidak ada data pengguna.</td></tr>'}
      </tbody></table></div>${tablePagination(rows.length, currentTablePage, pageSize)}
    </section></main>${renderFooter()}`;
  }

  function renderAccount(user) {
    const myPhotos = db.photos.filter(photo => photo.userId === user.id).length;
    const following = db.follows.filter(item => item.userId === user.id).length;
    return `${renderHeader(user, '/account')}<main class="userbody"><section class="akun_isicontainer narrow">
      <header>Hai, ${escapeHTML(user.name)}</header>
      <div class="profile-summary"><div class="avatar">${escapeHTML((user.name || 'S').charAt(0).toUpperCase())}</div><div><strong>${escapeHTML(user.name)}</strong><span>@${escapeHTML(user.username)} · ${user.role === 'admin' ? 'Administrator' : 'Pengguna'}</span></div></div>
      <div class="akun_isiparagraf">
        <p>Web Sharfo adalah sebuah platform yang dirancang untuk memberikan informasi mendalam tentang berbagai gambar bangunan bersejarah dan pemandangan alam dari seluruh dunia serta dengan tampilan yang sederhana. ${escapeHTML(user.name)}, dapat dengan mudah menemukan dan membagikan gambar yang mungkin sudah atau belum diketahui oleh pengguna lain, yang disertai juga dengan deskripsi di setiap gambar serta menyoroti keunikan dan latar belakangnya. Web Sharfo menjadi sumber inspirasi bagi para pelancong maupun penggemar sejarah.</p><br>
        <p>Terakhir kami sangat menghargai kunjungan ${escapeHTML(user.name)} ke Web Sharfo. Kami berharap Anda menemukan informasi yang bermanfaat dan inspiratif mengenai keindahan dunia di sekitar kita. Tanpa dukungan dan minat Anda, Web Sharfo tidak akan dapat terus berkembang dan menyajikan konten yang berkualitas. Mari bersama-sama menjaga keindahan warisan budaya dan alam kita! 😊</p>
      </div>
      <div class="akun-toolbar">
        ${user.role === 'user' ? `<a class="akun_butbox" href="#/my-photos">▧ Kelola Foto (${myPhotos})</a><a class="akun_butbox" href="#/followed">♡ Foto Diikuti (${following})</a>` : `<a class="akun_butbox" href="#/admin/users">♙ Data Akun User</a><a class="akun_butbox" href="#/admin/photos">▧ Data Foto</a>`}
        <button class="akun_butbox" type="button" data-action="reset-demo">↻ Pulihkan Data Awal</button>
        <button class="akun_butbox danger" type="button" data-action="logout">⇥ Logout</button>
      </div>
      <p class="muted" style="margin-top:16px">Penyimpanan demo berada di browser ini. Gunakan menu pengelolaan foto untuk menambah atau mengubah foto.</p>
    </section></main>${renderFooter()}`;
  }

  function renderPhotoForm(user, id) {
    const editing = id !== 'new';
    const photo = editing ? photoById(id) : null;
    if (editing && (!photo || (user.role !== 'admin' && photo.userId !== user.id))) {
      return `${renderHeader(user, '')}<section class="info-page"><h1>Foto tidak tersedia</h1><p>Anda tidak memiliki akses untuk mengubah foto tersebut.</p><a href="#/home">Kembali</a></section>${renderFooter()}`;
    }
    const p = photo || { name: '', country: '', date: new Date().toISOString().slice(0, 10), description: '', image: '' };
    return `${renderHeader(user, user.role === 'admin' ? '/admin/photos' : '/my-photos')}<main class="form-page"><section class="form-card">
      <header>${editing ? '✎ Edit Foto' : '＋ Tambah Foto'}${editing ? `<br><span class="muted">${escapeHTML(p.name)}</span>` : ''}</header>
      <form data-form="photo" data-id="${editing ? photo.id : 'new'}">
        ${editing && photo.archiveOnly ? '<p class="photo-archive-note">Foto ini merupakan file arsip yang tidak memiliki catatan pada tabel semfoto di SQL sumber. Lengkapi data di bawah agar informasi foto lebih jelas.</p>' : ''}
        <div class="form-grid">
          <div class="field"><label for="photoName">Nama Foto</label><input id="photoName" name="name" type="text" value="${escapeHTML(p.name)}" placeholder="Masukkan Nama Foto" required></div>
          <div class="field"><label for="photoCountry">Negara Asal Foto</label><input id="photoCountry" name="country" type="text" value="${escapeHTML(p.country)}" placeholder="Masukkan Nama Negara Dari Foto" required></div>
          <div class="field"><label for="photoDate">Tanggal Foto</label><input id="photoDate" name="date" type="date" value="${escapeHTML(p.date)}" required></div>
          ${user.role === 'admin' ? `<div class="field"><label for="photoOwner">Pemilik Foto</label><select id="photoOwner" name="userId">${photo && (photo.userId === null || photo.userId === undefined) ? '<option value="" selected>Belum ditentukan</option>' : ''}${db.users.map(u => `<option value="${u.id}" ${(photo ? photo.userId : user.id) === u.id ? 'selected' : ''}>${escapeHTML(u.username)} — ${escapeHTML(u.name)}</option>`).join('')}</select></div>` : ''}
          <div class="field full"><label for="photoDescription">Deskripsi</label><textarea id="photoDescription" name="description" placeholder="Masukkan Deskripsi" required>${escapeHTML(p.description)}</textarea></div>
          <div class="field full"><label for="photoImage">${editing ? 'Gambar Baru (opsional)' : 'Gambar Foto'}</label><input id="photoImage" name="image" type="file" accept="image/*" ${editing ? '' : 'required'}><span class="muted">File gambar akan disimpan secara lokal di browser. Disarankan ukuran kurang dari 5 MB.</span>${p.image ? `<img class="preview-image" src="${escapeHTML(p.image)}" alt="Gambar saat ini">` : ''}</div>
        </div>
        <div class="form-actions"><button class="akun_butbox" type="submit">✓ Konfirmasi</button><a class="akun_butbox" href="#/${user.role === 'admin' ? 'admin/photos' : 'my-photos'}">Kembali</a></div>
      </form>
    </section></main>${renderFooter()}`;
  }

  function renderUserForm(user, id) {
    const editing = id !== 'new';
    const item = editing ? db.users.find(u => u.id === Number(id) && u.role === 'user') : null;
    if (editing && !item) return `${renderHeader(user, '')}<section class="info-page"><h1>Pengguna tidak ditemukan</h1><a href="#/admin/users">Kembali</a></section>${renderFooter()}`;
    const u = item || { username: '', name: '', gender: 'pria', age: '', password: '' };
    return `${renderHeader(user, '/admin/users')}<main class="form-page"><section class="form-card">
      <header>${editing ? '✎ Edit Akun User' : '＋ Tambah Akun User'}</header>
      <form data-form="user" data-id="${editing ? item.id : 'new'}">
        <div class="form-grid">
          <div class="field"><label>Username</label><input type="text" name="username" maxlength="32" value="${escapeHTML(u.username)}" required></div>
          <div class="field"><label>Nama User</label><input type="text" name="name" maxlength="60" value="${escapeHTML(u.name)}" required></div>
          <div class="field"><label>Gender</label><select name="gender"><option value="pria" ${u.gender === 'pria' ? 'selected' : ''}>Pria</option><option value="perempuan" ${u.gender === 'perempuan' ? 'selected' : ''}>Perempuan</option></select></div>
          <div class="field"><label>Umur</label><input type="number" name="age" min="10" max="120" value="${escapeHTML(u.age)}" required></div>
          <div class="field full"><label>${editing ? 'Password Baru (kosongkan jika tidak diubah)' : 'Password'}</label><input type="password" name="password" minlength="4" ${editing ? '' : 'required'}></div>
        </div>
        <div class="form-actions"><button class="akun_butbox" type="submit">✓ Simpan</button><a class="akun_butbox" href="#/admin/users">Kembali</a></div>
      </form>
    </section></main>${renderFooter()}`;
  }

  function renderInfo(user, type) {
    const content = {
      about: ['Tentang Kami', 'Web Sharfo merupakan galeri berbagi informasi foto bangunan bersejarah dan pemandangan alam dari berbagai negara. Setiap foto dilengkapi nama, negara asal, tanggal, dan deskripsi untuk membantu pengunjung mengenal tempat tersebut.'],
      address: ['Alamat Kami', 'Sharfo merupakan proyek website demonstrasi dan tidak memiliki kantor layanan pengunjung fisik. Untuk pertanyaan mengenai website, silakan gunakan akun dan fitur yang tersedia pada halaman ini.'],
      register: ['Bagaimana Cara Daftar Akun', 'Untuk membuat akun, pilih tombol Akun atau Ikuti pada bagian navigasi, kemudian pilih Daftar. Isi username, nama, gender, umur, dan password. Setelah pendaftaran berhasil, masuk menggunakan username dan password yang telah dibuat.'],
      login: ['Bagaimana Cara Masuk Akun', 'Pilih Akun atau Ikuti pada navigasi, masukkan username dan password, lalu tekan Masuk. Pengguna dapat mencari dan mengikuti foto, sedangkan admin dapat mengelola data pengguna dan foto.']
    }[type] || ['Informasi', 'Informasi Sharfo.'];
    return `${renderHeader(user, '')}<main class="info-page"><h1>${escapeHTML(content[0])}</h1><p>${escapeHTML(content[1])}</p><br><a class="akun_butbox" href="#/home">Kembali ke Beranda</a></main>${renderFooter()}`;
  }

  function render() {
    const route = routePath();
    const user = currentUser();
    let html = '';

    if (route === '/home' || route === '/') html = renderHome(user);
    else if (route === '/login') html = renderLogin();
    else if (route === '/register') html = renderRegister();
    else if (route === '/account') html = user ? renderAccount(user) : renderLogin();
    else if (route === '/followed') html = user ? renderFollowed(user) : renderLogin();
    else if (route === '/my-photos') html = user && user.role === 'user' ? renderPhotoTable(user, false) : (user ? renderHome(user) : renderLogin());
    else if (route === '/admin/users') html = user && user.role === 'admin' ? renderUserTable(user) : (user ? renderHome(user) : renderLogin());
    else if (route === '/admin/photos') html = user && user.role === 'admin' ? renderPhotoTable(user, true) : (user ? renderHome(user) : renderLogin());
    else if (route.startsWith('/photo/')) {
      const id = route.split('/')[2];
      if (!user) goLoginForPhoto(id);
      else html = renderPhotoDetail(user, id);
    }
    else if (route.startsWith('/photo-form/')) html = user ? renderPhotoForm(user, route.split('/')[2]) : renderLogin();
    else if (route.startsWith('/user-form/')) html = user && user.role === 'admin' ? renderUserForm(user, route.split('/')[2]) : (user ? renderHome(user) : renderLogin());
    else if (route.startsWith('/info/')) html = renderInfo(user, route.split('/')[2]);
    else html = renderHome(user);

    document.getElementById('app').innerHTML = html;
    if (route === '/home') startSlider();
    else stopSlider();
    if (route === '/home' && user && user.role === 'user') {
      const search = document.querySelector('[data-search-home]');
      if (search && homeSearch) search.focus({ preventScroll: true });
    }
  }

  function startSlider() {
    stopSlider();
    updateSlider();
    sliderTimer = setInterval(() => {
      activeSlide = (activeSlide + 1) % SLIDER_IMAGES.length;
      updateSlider();
    }, 3500);
  }

  function stopSlider() {
    if (sliderTimer) clearInterval(sliderTimer);
    sliderTimer = null;
  }

  function updateSlider() {
    const track = document.getElementById('slideTrack');
    if (track) track.style.transform = `translateX(-${activeSlide * 100}%)`;
    document.querySelectorAll('.slide-dots button').forEach((button, index) => button.classList.toggle('active', index === activeSlide));
  }

  function imageToDataURL(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      if (!file.type.startsWith('image/')) return reject(new Error('File yang dipilih harus berupa gambar.'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gambar tidak dapat dibaca.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Format gambar tidak dapat diproses.'));
        img.onload = () => {
          const maxSide = 1500;
          const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * ratio));
          canvas.height = Math.max(1, Math.round(img.height * ratio));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', .82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function hexToBytes(hex) {
    // Terima heksadesimal biasa dan hilangkan spasi/pemisah dari data lama.
    const clean = String(hex ?? '').trim().replace(/^0x/i, '').replace(/[\s:-]/g, '');
    if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) {
      throw new Error('Salt admin pada data awal tidak valid. Ekstrak ulang folder versi terbaru.');
    }
    return new Uint8Array(clean.match(/.{2}/g).map(pair => parseInt(pair, 16)));
  }

  function bytesToHex(bytes) {
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function hashAdminPassword(password, user) {
    if (!window.crypto || !window.crypto.subtle || typeof TextEncoder === 'undefined') {
      throw new Error('Browser tidak mendukung verifikasi password aman. Gunakan Chrome atau Edge versi terbaru.');
    }
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const derivedBits = await window.crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: hexToBytes(user.passwordSalt),
      iterations: Number(user.passwordIterations) || 210000,
      hash: 'SHA-256'
    }, keyMaterial, 256);
    return bytesToHex(derivedBits);
  }

  function constantTimeEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
    let difference = 0;
    for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
    return difference === 0;
  }

  async function handleLogin(form) {
    const data = new FormData(form);
    const username = String(data.get('username') || '').trim().toLowerCase();
    const password = String(data.get('password') || '');
    const user = db.users.find(item => String(item.username || '').trim().toLowerCase() === username);
    if (!user) return showToast('Username atau password tidak sesuai.');

    let isValid = false;
    const seedAdmin = (window.SHARFO_SEED?.users || []).find(item =>
      (String(item.username || '').trim().toLowerCase() === 'admin123' || String(item.username || '').trim().toLowerCase() === 'admin' || item.role === 'admin')
    );
    const isAdminLogin = username === 'admin123' || user.role === 'admin';

    if (isAdminLogin) {
      try {
        if (!seedAdmin || !seedAdmin.passwordSalt || !seedAdmin.passwordHash) {
          throw new Error('Data verifikasi admin tidak ditemukan. Periksa file js/seed-data.js.');
        }

        // PENTING: verifikasi memakai salt/hash kanonis dari seed-data.js,
        // bukan nilai localStorage yang dapat rusak atau pernah diedit.
        const enteredHash = await hashAdminPassword(password, seedAdmin);
        isValid = constantTimeEqual(enteredHash, seedAdmin.passwordHash);

        if (isValid) {
          user.role = 'admin';
          user.passwordAlgorithm = seedAdmin.passwordAlgorithm;
          user.passwordIterations = seedAdmin.passwordIterations;
          user.passwordSalt = seedAdmin.passwordSalt;
          user.passwordHash = seedAdmin.passwordHash;
          delete user.password;
        }
      } catch (error) {
        console.error('Verifikasi password admin gagal:', error);
        return showToast(error.message || 'Tidak dapat memverifikasi password admin.');
      }
    } else {
      // Password akun pengguna biasa tetap memakai mekanisme lama.
      isValid = user.password === password;
    }

    if (!isValid) return showToast('Username atau password tidak sesuai.');
    db.sessionUserId = user.id;
    saveDatabase();
    const next = sessionStorage.getItem('sharfo-after-login');
    sessionStorage.removeItem('sharfo-after-login');
    showToast(`Selamat datang, ${user.name}!`);
    go(next || (user.role === 'admin' ? '/admin/photos' : '/home'));
  }

  function handleRegister(form) {
    const data = new FormData(form);
    const username = String(data.get('username') || '').trim();
    const name = String(data.get('name') || '').trim();
    const password = String(data.get('password') || '');
    const confirm = String(data.get('confirm') || '');
    const age = Number(data.get('age'));
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return showToast('Username minimal 3 karakter dan hanya boleh memakai huruf, angka, titik, garis bawah, atau minus.');
    if (db.users.some(item => item.username.toLowerCase() === username.toLowerCase())) return showToast('Username sudah digunakan. Silakan pilih username lain.');
    if (password.length < 4) return showToast('Password minimal 4 karakter.');
    if (password !== confirm) return showToast('Konfirmasi password tidak sama.');
    if (!Number.isFinite(age) || age < 10 || age > 120) return showToast('Umur tidak valid.');
    db.users.push({ id: nextId(db.users), username, name, gender: data.get('gender') || 'pria', age, password, role: 'user' });
    saveDatabase();
    showToast('Pendaftaran berhasil. Silakan masuk.');
    go('/login');
  }

  async function handlePhotoForm(form) {
    const data = new FormData(form);
    const id = form.dataset.id;
    const editing = id !== 'new';
    let photo = editing ? photoById(id) : null;
    if (editing && (!photo || (currentUser().role !== 'admin' && photo.userId !== currentUser().id))) return showToast('Anda tidak memiliki akses mengubah foto ini.');
    const file = form.querySelector('input[name="image"]')?.files?.[0];
    let image = photo ? photo.image : '';
    try {
      if (file) image = await imageToDataURL(file);
    } catch (error) {
      return showToast(error.message || 'Gagal memproses gambar.');
    }
    if (!image) return showToast('Silakan pilih gambar foto.');
    const values = {
      name: String(data.get('name') || '').trim(),
      country: String(data.get('country') || '').trim(),
      date: String(data.get('date') || ''),
      description: String(data.get('description') || '').trim(),
      image
    };
    if (!values.name || !values.country || !values.date || !values.description) return showToast('Lengkapi semua data foto.');
    if (editing) {
      Object.assign(photo, values);
      if (currentUser().role === 'admin' && data.get('userId')) photo.userId = Number(data.get('userId'));
    } else {
      db.photos.unshift({ id: nextId(db.photos), userId: currentUser().id, ...values });
    }
    if (!saveDatabase()) return;
    currentTablePage = 1;
    showToast(editing ? 'Data foto berhasil diperbarui.' : 'Foto berhasil ditambahkan.');
    go(currentUser().role === 'admin' ? '/admin/photos' : '/my-photos');
  }

  function handleUserForm(form) {
    const data = new FormData(form);
    const id = form.dataset.id;
    const editing = id !== 'new';
    const target = editing ? db.users.find(item => item.id === Number(id) && item.role === 'user') : null;
    const username = String(data.get('username') || '').trim();
    const name = String(data.get('name') || '').trim();
    const password = String(data.get('password') || '');
    const age = Number(data.get('age'));
    if (!target && editing) return showToast('Data pengguna tidak ditemukan.');
    if (db.users.some(item => item.id !== (target?.id || -1) && item.username.toLowerCase() === username.toLowerCase())) return showToast('Username sudah digunakan.');
    if (!username || !name || !Number.isFinite(age) || age < 10 || age > 120) return showToast('Periksa kembali data pengguna.');
    if (!editing && password.length < 4) return showToast('Password minimal 4 karakter.');
    if (editing) {
      target.username = username; target.name = name; target.gender = data.get('gender'); target.age = age;
      if (password) target.password = password;
    } else {
      db.users.push({ id: nextId(db.users), username, name, gender: data.get('gender'), age, password, role: 'user' });
    }
    saveDatabase();
    currentTablePage = 1;
    showToast(editing ? 'Akun pengguna berhasil diperbarui.' : 'Akun pengguna berhasil ditambahkan.');
    go('/admin/users');
  }

  function logout() {
    db.sessionUserId = null;
    saveDatabase();
    homeSearch = '';
    tableSearch = '';
    showToast('Anda berhasil keluar dari akun.');
    go('/home');
  }

  document.addEventListener('click', event => {
    const infoButton = event.target.closest('[data-info]');
    if (infoButton) { go(`/info/${infoButton.dataset.info}`); return; }

    const photoLink = event.target.closest('[data-photo-open]');
    if (photoLink) {
      event.preventDefault();
      const id = photoLink.dataset.photoOpen;
      if (!currentUser()) goLoginForPhoto(id);
      else go(`/photo/${id}`);
      return;
    }

    const dot = event.target.closest('[data-slide]');
    if (dot) { activeSlide = Number(dot.dataset.slide); updateSlider(); return; }

    const pageButton = event.target.closest('[data-page]');
    if (pageButton) { currentTablePage = Number(pageButton.dataset.page); render(); return; }

    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'prev-slide') { activeSlide = (activeSlide - 1 + SLIDER_IMAGES.length) % SLIDER_IMAGES.length; updateSlider(); }
    else if (action === 'next-slide') { activeSlide = (activeSlide + 1) % SLIDER_IMAGES.length; updateSlider(); }
    else if (action === 'follow-photo') followPhoto(button.dataset.id);
    else if (action === 'unfollow-photo') {
      db.follows = db.follows.filter(item => !(item.userId === db.sessionUserId && item.photoId === Number(button.dataset.id)));
      saveDatabase(); showToast('Foto berhasil dihapus dari daftar Ikuti.'); render();
    }
    else if (action === 'delete-photo') {
      const id = Number(button.dataset.id);
      showConfirm('Hapus Foto?', 'Foto yang dihapus tidak dapat dikembalikan. Apakah Anda yakin?', 'Ya, Hapus', () => {
        db.photos = db.photos.filter(photo => photo.id !== id);
        db.follows = db.follows.filter(item => item.photoId !== id);
        saveDatabase(); showToast('Foto berhasil dihapus.'); currentTablePage = 1; render();
      });
    }
    else if (action === 'delete-user') {
      const id = Number(button.dataset.id);
      showConfirm('Hapus Akun User?', 'Foto milik pengguna dan hubungan Ikuti yang terkait juga akan dihapus. Lanjutkan?', 'Ya, Hapus', () => {
        const photoIds = db.photos.filter(photo => photo.userId === id).map(photo => photo.id);
        db.photos = db.photos.filter(photo => photo.userId !== id);
        db.users = db.users.filter(item => item.id !== id);
        db.follows = db.follows.filter(item => item.userId !== id && !photoIds.includes(item.photoId));
        saveDatabase(); showToast('Akun pengguna berhasil dihapus.'); currentTablePage = 1; render();
      });
    }
    else if (action === 'logout') showConfirm('Keluar dari akun?', 'Anda akan kembali ke halaman utama Sharfo.', 'Logout', logout);
    else if (action === 'close-modal') closeModal();
    else if (action === 'confirm-modal') { const callback = pendingConfirm; closeModal(); if (callback) callback(); }
    else if (action === 'modal-backdrop' && event.target.classList.contains('modal-backdrop')) closeModal();
    else if (action === 'reset-demo') showConfirm('Pulihkan Data Contoh?', 'Semua perubahan yang tersimpan di browser ini akan dihapus dan dikembalikan ke data awal.', 'Pulihkan', resetDatabase);
  });

  document.addEventListener('submit', event => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const type = form.dataset.form;
    if (type === 'login') handleLogin(form);
    else if (type === 'register') handleRegister(form);
    else if (type === 'photo') handlePhotoForm(form);
    else if (type === 'user') handleUserForm(form);
  });

  document.addEventListener('input', event => {
    const target = event.target;
    if (target.matches('[data-search-home]')) {
      homeSearch = target.value;
      const main = document.querySelector('.home-wrap');
      if (main) {
        const gallery = main.querySelector('.all-photo');
        if (gallery) gallery.outerHTML = homeGalleryMarkup();
      }
    } else if (target.matches('[data-filter-followed]')) {
      tableSearch = target.value; currentTablePage = 1;
      const value = target.value;
      // Preserve the input cursor by refreshing only the table region through a full rerender and refocus.
      render(); const refreshed = document.querySelector('[data-filter-followed]');
      if (refreshed) { refreshed.focus(); refreshed.setSelectionRange(value.length, value.length); }
    } else if (target.matches('[data-filter-photos]')) {
      tableSearch = target.value; currentTablePage = 1;
      const value = target.value; render(); const refreshed = document.querySelector('[data-filter-photos]');
      if (refreshed) { refreshed.focus(); refreshed.setSelectionRange(value.length, value.length); }
    } else if (target.matches('[data-filter-users]')) {
      tableSearch = target.value; currentTablePage = 1;
      const value = target.value; render(); const refreshed = document.querySelector('[data-filter-users]');
      if (refreshed) { refreshed.focus(); refreshed.setSelectionRange(value.length, value.length); }
    }
  });

  window.addEventListener('hashchange', () => {
    currentTablePage = 1;
    tableSearch = '';
    render();
  });

  // Handy keyboard behaviour: Escape closes the confirmation dialog.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeModal();
  });

  // Initialize the first route without requiring a PHP server.
  render();
})();