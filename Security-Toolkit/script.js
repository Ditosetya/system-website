'use strict';

/* ========================================================================
 * CRYPTO VAULT — Browser Security Toolkit
 * ------------------------------------------------------------------------
 * Semua proses berlangsung di browser menggunakan Web Crypto API.
 * Format baru kompatibel dengan TVLT versi 2 (HTML Enhanced sebelumnya).
 * Dekripsi format lama (3x AES-GCM + PBKDF2 100.000 iterasi/lapis) tersedia.
 * ====================================================================== */

const CryptoVault = (() => {
  // ----------------------------------------------------------------------
  // Konstanta format dan batas penggunaan
  // ----------------------------------------------------------------------
  const UTF8 = new TextEncoder();
  const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true });
  const MAGIC = new Uint8Array([84, 86, 76, 84]); // ASCII: TVLT
  const FORMAT_VERSION = 2;
  const PBKDF2_ITERATIONS = 600000;
  const LEGACY_ITERATIONS = 100000;
  const HEADER_SIZE = 73; // 4 magic + 1 version + 16 salt + 16 HKDF salt + 36 IV
  const GCM_TAG_BYTES = 16;
  const MAX_TEXT_BYTES = 10 * 1024 * 1024;
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const MAX_VAULT_BYTES = 101 * 1024 * 1024;
  const $ = (id) => document.getElementById(id);

  let busy = false;
  let currentHash = '';
  let currentHashAlgorithm = 'SHA-256';

  // ----------------------------------------------------------------------
  // Status, state, dan dukungan browser
  // ----------------------------------------------------------------------
  function setStatus(message, type = '') {
    const status = $('vaultStatus');
    const messageNode = status.querySelector('span:last-child');
    messageNode.textContent = message;
    status.className = 'status-line global-status' + (type ? ' ' + type : '');
  }

  function setBusy(value) {
    busy = value;
    document.querySelectorAll('.operation').forEach((button) => {
      button.disabled = value;
    });
    ['filesToEncrypt', 'filesToDecrypt', 'hashFileInput'].forEach((id) => {
      const input = $(id);
      if (input) input.disabled = value;
    });
  }

  function requireCrypto() {
    if (!window.isSecureContext) {
      throw new Error('Halaman tidak berada dalam secure context. Gunakan HTTPS melalui GitHub Pages atau localhost.');
    }
    if (!window.crypto || !window.crypto.subtle || !window.crypto.getRandomValues) {
      throw new Error('Web Crypto API tidak tersedia. Gunakan browser modern melalui HTTPS.');
    }
  }

  function randomBytes(length) {
    requireCrypto();
    if (!Number.isInteger(length) || length < 1 || length > 65536) {
      throw new Error('Jumlah byte acak harus antara 1 dan 65.536 byte.');
    }
    return window.crypto.getRandomValues(new Uint8Array(length));
  }

  // ----------------------------------------------------------------------
  // Utilitas biner, encoding, dan nama file
  // ----------------------------------------------------------------------
  function concatBytes(...arrays) {
    const total = arrays.reduce((sum, item) => sum + item.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const item of arrays) {
      result.set(item, offset);
      offset += item.length;
    }
    return result;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    return window.btoa(binary);
  }

  function base64ToBytes(value) {
    let clean = String(value)
      .trim()
      .replace(/^TVLT2\./i, '')
      .replace(/\s+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    if (!clean || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) {
      throw new Error('Format Base64 tidak valid. Periksa kembali kode terenkripsi.');
    }

    clean = clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), '=');
    let binary;
    try {
      binary = window.atob(clean);
    } catch {
      throw new Error('Kode terenkripsi bukan Base64 yang valid.');
    }

    const output = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i);
    return output;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function hexToBytes(hex) {
    const clean = String(hex).replace(/\s+/g, '').replace(/^0x/i, '');
    if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) {
      throw new Error('Data hexadecimal tidak valid.');
    }
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  function isV2Vault(bytes) {
    return bytes.length >= HEADER_SIZE + (GCM_TAG_BYTES * 3)
      && MAGIC.every((value, index) => bytes[index] === value)
      && bytes[4] === FORMAT_VERSION;
  }

  function safeFilename(filename) {
    const clean = String(filename || 'file-pulihan')
      .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
      .replace(/^\.+$/, '')
      .trim();
    return (clean.slice(0, 180) || 'file-pulihan');
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index ? 2 : 0)} ${units[index]}`;
  }

  function downloadBytes(bytes, filename, mimeType = 'application/octet-stream') {
    const blob = new Blob([bytes], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = safeFilename(filename);
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  }

  function downloadText(text, filename) {
    downloadBytes(UTF8.encode(text), filename, 'text/plain;charset=utf-8');
  }

  // ----------------------------------------------------------------------
  // SHA-2 helpers — dipakai oleh fitur Hash dan verifikasi payload
  // ----------------------------------------------------------------------
  async function digestBytes(bytes, algorithm = 'SHA-256') {
    requireCrypto();
    if (!['SHA-256', 'SHA-384', 'SHA-512'].includes(algorithm)) {
      throw new Error('Algoritma hash tidak didukung.');
    }
    const digest = await window.crypto.subtle.digest(algorithm, bytes);
    return new Uint8Array(digest);
  }

  async function digestHex(bytes, algorithm = 'SHA-256') {
    return bytesToHex(await digestBytes(bytes, algorithm));
  }

  async function verifyPayloadHash(data, metadata) {
    // Metadata hash tidak ada pada beberapa TVLT2 awal, sehingga opsional.
    if (!metadata || typeof metadata.sha256 !== 'string') return true;
    const actual = await digestHex(data, 'SHA-256');
    if (!constantTimeStringEqual(actual, metadata.sha256.toLowerCase())) {
      throw new Error('Fingerprint SHA-256 tidak cocok. Payload tidak lolos pemeriksaan integritas.');
    }
    return true;
  }

  function constantTimeStringEqual(left, right) {
    const a = UTF8.encode(String(left));
    const b = UTF8.encode(String(right));
    let difference = a.length ^ b.length;
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i += 1) {
      difference |= (a[i] || 0) ^ (b[i] || 0);
    }
    return difference === 0;
  }

  // ----------------------------------------------------------------------
  // KDF: PBKDF2 -> root key -> tiga subkey melalui HKDF
  // ----------------------------------------------------------------------
  async function deriveRootKey(password, salt) {
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw', UTF8.encode(password), 'PBKDF2', false, ['deriveBits']
    );

    const rootBits = await window.crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    }, keyMaterial, 256);

    const rootKey = await window.crypto.subtle.importKey(
      'raw', rootBits, 'HKDF', false, ['deriveKey']
    );

    // Upaya mengosongkan material sementara; JavaScript tidak menjamin
    // penghapusan seluruh salinan memori internal browser.
    new Uint8Array(rootBits).fill(0);
    return rootKey;
  }

  async function deriveLayerKey(rootKey, hkdfSalt, layerNumber) {
    return window.crypto.subtle.deriveKey({
      name: 'HKDF',
      hash: 'SHA-256',
      salt: hkdfSalt,
      info: UTF8.encode(`TRIPLE-VAULT|V2|AES-256-GCM|LAYER-${layerNumber}`)
    }, rootKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  function layerAAD(layerNumber) {
    return UTF8.encode(`TRIPLE-VAULT|V2|LAYER-${layerNumber}`);
  }

  async function encryptV2(plainBytes, password, onStage = () => {}) {
    const pbkdfSalt = randomBytes(16);
    const hkdfSalt = randomBytes(16);
    const ivs = [randomBytes(12), randomBytes(12), randomBytes(12)];

    onStage('Membuat kunci enkripsi dengan PBKDF2 600.000 iterasi...');
    const rootKey = await deriveRootKey(password, pbkdfSalt);
    let current = plainBytes;

    for (let layer = 1; layer <= 3; layer += 1) {
      onStage(`Mengenkripsi lapisan ${layer} dari 3...`);
      const layerKey = await deriveLayerKey(rootKey, hkdfSalt, layer);
      const encrypted = new Uint8Array(await window.crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv: ivs[layer - 1],
        additionalData: layerAAD(layer),
        tagLength: 128
      }, layerKey, current));

      if (layer > 1) current.fill(0);
      current = encrypted;
    }

    const header = concatBytes(
      MAGIC,
      new Uint8Array([FORMAT_VERSION]),
      pbkdfSalt,
      hkdfSalt,
      ...ivs
    );
    const result = concatBytes(header, current);
    current.fill(0);
    return result;
  }

  async function decryptV2(vaultBytes, password, onStage = () => {}) {
    if (!isV2Vault(vaultBytes)) {
      throw new Error('Header atau versi file Vault tidak dikenali atau rusak.');
    }
    if (vaultBytes.length < HEADER_SIZE + (GCM_TAG_BYTES * 3)) {
      throw new Error('Data Vault terlalu pendek atau tidak lengkap.');
    }

    let offset = 5;
    const pbkdfSalt = vaultBytes.slice(offset, offset + 16); offset += 16;
    const hkdfSalt = vaultBytes.slice(offset, offset + 16); offset += 16;
    const ivs = [];
    for (let i = 0; i < 3; i += 1) {
      ivs.push(vaultBytes.slice(offset, offset + 12));
      offset += 12;
    }

    const rootKey = await deriveRootKey(password, pbkdfSalt);
    let current = vaultBytes.slice(HEADER_SIZE);

    try {
      onStage('Menurunkan kunci untuk dekripsi...');
      for (let layer = 3; layer >= 1; layer -= 1) {
        onStage(`Memverifikasi dan membuka lapisan ${layer}...`);
        const layerKey = await deriveLayerKey(rootKey, hkdfSalt, layer);
        const decrypted = new Uint8Array(await window.crypto.subtle.decrypt({
          name: 'AES-GCM',
          iv: ivs[layer - 1],
          additionalData: layerAAD(layer),
          tagLength: 128
        }, layerKey, current));
        current.fill(0);
        current = decrypted;
      }
      return current;
    } catch (error) {
      current.fill(0);
      throw error;
    }
  }

  // ----------------------------------------------------------------------
  // Kompatibilitas dekripsi versi lama dari HTML asli pengguna
  // ----------------------------------------------------------------------
  async function deriveLegacyKey(password, salt, suffix) {
    const material = await window.crypto.subtle.importKey(
      'raw', UTF8.encode(password + suffix), 'PBKDF2', false, ['deriveKey']
    );
    return window.crypto.subtle.deriveKey({
      name: 'PBKDF2', salt, iterations: LEGACY_ITERATIONS, hash: 'SHA-256'
    }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function decryptLegacyLayer(combined, password, suffix) {
    if (combined.length < 44) throw new Error('Data enkripsi versi lama tidak lengkap.');
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const ciphertext = combined.slice(28);
    const key = await deriveLegacyKey(password, salt, suffix);
    const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new Uint8Array(decrypted);
  }

  async function decryptLegacy(encoded, password, onStage = () => {}) {
    onStage('Membuka format lama (PBKDF2 100.000 iterasi per lapisan)...');
    let current = base64ToBytes(encoded);
    try {
      for (const suffix of ['_LAYER_3', '_LAYER_2', '_LAYER_1']) {
        const next = await decryptLegacyLayer(current, password, suffix);
        current.fill(0);
        current = next;
      }
      return current;
    } catch (error) {
      current.fill(0);
      throw error;
    }
  }

  // ----------------------------------------------------------------------
  // Payload metadata dan integritas isi
  // ----------------------------------------------------------------------
  async function packPayload(dataBytes, metadata) {
    const safeMetadata = {
      ...metadata,
      payloadVersion: 2,
      sha256: await digestHex(dataBytes, 'SHA-256')
    };
    const metadataBytes = UTF8.encode(JSON.stringify(safeMetadata));
    if (metadataBytes.length === 0 || metadataBytes.length > 65535) {
      throw new Error('Metadata file terlalu besar atau tidak valid.');
    }
    const sizePrefix = new Uint8Array(4);
    new DataView(sizePrefix.buffer).setUint32(0, metadataBytes.length, false);
    return concatBytes(sizePrefix, metadataBytes, dataBytes);
  }

  function unpackPayload(payloadBytes) {
    if (payloadBytes.length < 4) throw new Error('Payload Vault tidak lengkap.');
    const metadataLength = new DataView(
      payloadBytes.buffer, payloadBytes.byteOffset, 4
    ).getUint32(0, false);

    if (metadataLength === 0 || metadataLength > 65535 || 4 + metadataLength > payloadBytes.length) {
      throw new Error('Metadata Vault tidak valid.');
    }

    let metadata;
    try {
      metadata = JSON.parse(UTF8_FATAL.decode(payloadBytes.slice(4, 4 + metadataLength)));
    } catch {
      throw new Error('Metadata Vault tidak dapat dibaca.');
    }

    if (!metadata || !['text', 'file'].includes(metadata.kind)) {
      throw new Error('Jenis data di dalam Vault tidak dikenali.');
    }
    return { metadata, data: payloadBytes.slice(4 + metadataLength) };
  }

  function getPassword(forEncryption) {
    const password = $('secretKey').value;
    if (!password) throw new Error('Masukkan password utama terlebih dahulu.');
    if (password.length > 256 || UTF8.encode(password).length > 1024) {
      throw new Error('Password terlalu panjang. Batas maksimum 256 karakter / 1.024 byte UTF-8.');
    }
    if (forEncryption) {
      if ([...password].length < 12) {
        throw new Error('Gunakan password minimal 12 karakter untuk enkripsi baru.');
      }
      if (password !== $('confirmPassword').value) {
        throw new Error('Konfirmasi password tidak sama.');
      }
    }
    return password;
  }

  async function decryptPayloadAndVerify(vaultBytes, password, onStage) {
    const payload = await decryptV2(vaultBytes, password, onStage);
    try {
      const unpacked = unpackPayload(payload);
      await verifyPayloadHash(unpacked.data, unpacked.metadata);
      return {
        metadata: unpacked.metadata,
        data: unpacked.data.slice()
      };
    } finally {
      payload.fill(0);
    }
  }

  // ----------------------------------------------------------------------
  // Operasi Vault: teks
  // ----------------------------------------------------------------------
  async function encryptText() {
    if (busy) return;
    try {
      requireCrypto();
      const password = getPassword(true);
      const input = $('inputText').value;
      if (!input) throw new Error('Masukkan teks yang ingin dienkripsi.');
      const plainBytes = UTF8.encode(input);
      if (plainBytes.length > MAX_TEXT_BYTES) {
        plainBytes.fill(0);
        throw new Error('Ukuran teks melewati batas 10 MB.');
      }

      setBusy(true);
      setStatus('Menyiapkan payload dan menghitung fingerprint SHA-256...');
      let payload;
      try {
        payload = await packPayload(plainBytes, {
          kind: 'text',
          createdAt: new Date().toISOString()
        });
        const encrypted = await encryptV2(payload, password, setStatus);
        $('outputText').value = `TVLT2.${bytesToBase64(encrypted)}`;
        encrypted.fill(0);
        setStatus('Enkripsi teks berhasil. Integritas payload dicatat dalam metadata terautentikasi.', 'success');
      } finally {
        plainBytes.fill(0);
        if (payload) payload.fill(0);
      }
    } catch (error) {
      setStatus(readableCryptoError(error, 'Enkripsi teks gagal.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function decryptText() {
    if (busy) return;
    let rawVault;
    try {
      requireCrypto();
      const password = getPassword(false);
      const input = $('inputText').value.trim();
      if (!input) throw new Error('Tempel kode terenkripsi yang ingin didekripsi.');
      setBusy(true);

      rawVault = base64ToBytes(input);
      if (!isV2Vault(rawVault)) {
        const legacyPlain = await decryptLegacy(input, password, setStatus);
        try {
          $('outputText').value = UTF8_FATAL.decode(legacyPlain);
          setStatus('Dekripsi format lama berhasil. Disarankan enkripsi ulang dengan format TVLT2 terbaru.', 'success');
        } finally {
          legacyPlain.fill(0);
        }
        return;
      }

      const restored = await decryptPayloadAndVerify(rawVault, password, setStatus);
      try {
        if (restored.metadata.kind === 'text') {
          $('outputText').value = UTF8_FATAL.decode(restored.data);
          setStatus('Dekripsi berhasil. Autentikasi AES-GCM dan fingerprint SHA-256 terverifikasi.', 'success');
        } else {
          const name = safeFilename(restored.metadata.name || 'file-pulihan');
          const mime = typeof restored.metadata.mimeType === 'string'
            ? restored.metadata.mimeType : 'application/octet-stream';
          downloadBytes(restored.data, name, mime);
          $('outputText').value = `Vault berisi file: ${name}\nUkuran: ${formatBytes(restored.data.length)}\nFile hasil dekripsi telah diunduh.`;
          setStatus('Vault berhasil dibuka. Autentikasi dan fingerprint data valid; file telah diunduh.', 'success');
        }
      } finally {
        restored.data.fill(0);
      }
    } catch (error) {
      $('outputText').value = '';
      setStatus(readableCryptoError(error, 'Dekripsi gagal. Password mungkin salah atau data telah rusak.'), 'error');
    } finally {
      if (rawVault) rawVault.fill(0);
      setBusy(false);
    }
  }

  // ----------------------------------------------------------------------
  // Operasi Vault: batch file
  // ----------------------------------------------------------------------
  function updateFileList(inputId, outputId) {
    const files = Array.from($(inputId).files || []);
    const target = $(outputId);
    if (files.length === 0) {
      target.textContent = 'Belum ada file dipilih.';
      return;
    }
    const names = files.slice(0, 3).map((file) => `${file.name} (${formatBytes(file.size)}`);
    target.textContent = `${files.length} file: ${names.join(', ')}${files.length > 3 ? `, dan ${files.length - 3} lainnya` : ''}`;
  }

  function setProgress(label, completed, total) {
    $('progressWrap').hidden = false;
    $('progressLabel').textContent = label;
    $('progressCount').textContent = `${completed} / ${total}`;
    $('progressBar').value = total ? (completed / total) * 100 : 0;
  }

  function hideProgress() {
    $('progressWrap').hidden = true;
    $('progressBar').value = 0;
  }

  async function encryptOneFile(file, password) {
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`Ukuran ${file.name} melewati batas 100 MB.`);
    }
    const plainBytes = new Uint8Array(await file.arrayBuffer());
    let payload;
    let encrypted;
    try {
      payload = await packPayload(plainBytes, {
        kind: 'file',
        name: safeFilename(file.name),
        mimeType: file.type || 'application/octet-stream',
        lastModified: Number.isFinite(file.lastModified) ? file.lastModified : null,
        createdAt: new Date().toISOString()
      });
      encrypted = await encryptV2(payload, password, setStatus);
      downloadBytes(encrypted, `${safeFilename(file.name)}.vault`);
    } finally {
      plainBytes.fill(0);
      if (payload) payload.fill(0);
      if (encrypted) encrypted.fill(0);
    }
  }

  async function encryptFiles() {
    if (busy) return;
    const files = Array.from($('filesToEncrypt').files || []);
    try {
      requireCrypto();
      if (!files.length) throw new Error('Pilih setidaknya satu file untuk dienkripsi.');
      const password = getPassword(true);
      if (files.some((file) => file.size > MAX_FILE_BYTES)) {
        throw new Error('Ada file yang melebihi batas 100 MB. Hapus file tersebut dari pilihan.');
      }

      setBusy(true);
      let succeeded = 0;
      const failed = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        setProgress(`Mengenkripsi: ${file.name}`, i, files.length);
        setStatus(`Memproses file ${i + 1} dari ${files.length}: ${file.name}`);
        try {
          await encryptOneFile(file, password);
          succeeded += 1;
        } catch (error) {
          failed.push(`${file.name}: ${readableCryptoError(error, 'gagal')}`);
        }
        setProgress(`Selesai: ${file.name}`, i + 1, files.length);
      }

      if (failed.length) {
        const summary = failed.slice(0, 3).join(' | ');
        setStatus(`${succeeded} file berhasil dienkripsi; ${failed.length} gagal. ${summary}`, 'warning');
      } else {
        setStatus(`${succeeded} file berhasil dienkripsi. File .vault telah diunduh satu per satu.`, 'success');
      }
    } catch (error) {
      setStatus(readableCryptoError(error, 'Enkripsi file gagal.'), 'error');
    } finally {
      setBusy(false);
      window.setTimeout(hideProgress, 1500);
    }
  }

  async function decryptOneFile(file, password) {
    if (file.size > MAX_VAULT_BYTES) {
      throw new Error(`Ukuran ${file.name} melebihi batas 101 MB.`);
    }
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    let legacyPlain;
    let restored;
    try {
      if (isV2Vault(fileBytes)) {
        restored = await decryptPayloadAndVerify(fileBytes, password, setStatus);
        const outputName = safeFilename(restored.metadata.name || file.name.replace(/\.vault$/i, '') || 'file-pulihan');
        if (restored.metadata.kind === 'file') {
          const mime = typeof restored.metadata.mimeType === 'string'
            ? restored.metadata.mimeType : 'application/octet-stream';
          downloadBytes(restored.data, outputName, mime);
        } else {
          let text;
          try { text = UTF8_FATAL.decode(restored.data); }
          catch { throw new Error('Vault berisi teks yang bukan UTF-8 valid. Gunakan mode Vault teks untuk pemulihan manual.'); }
          downloadText(text, `${outputName || 'pesan-pulihan'}.txt`);
        }
      } else {
        // File legacy pada versi awal berbentuk file teks yang berisi Base64.
        let legacyEncoded;
        try { legacyEncoded = UTF8_FATAL.decode(fileBytes).trim(); }
        catch { throw new Error('File bukan format TVLT2 atau file Base64 format lama.'); }
        legacyPlain = await decryptLegacy(legacyEncoded, password, setStatus);
        const restoredText = UTF8_FATAL.decode(legacyPlain);
        const outputName = safeFilename(file.name.replace(/\.vault$/i, '') || 'hasil-dekripsi.txt');
        downloadText(restoredText, outputName.toLowerCase().endsWith('.txt') ? outputName : `${outputName}.txt`);
      }
    } finally {
      fileBytes.fill(0);
      if (legacyPlain) legacyPlain.fill(0);
      if (restored && restored.data) restored.data.fill(0);
    }
  }

  async function decryptFiles() {
    if (busy) return;
    const files = Array.from($('filesToDecrypt').files || []);
    try {
      requireCrypto();
      if (!files.length) throw new Error('Pilih setidaknya satu file Vault untuk didekripsi.');
      const password = getPassword(false);
      if (files.some((file) => file.size > MAX_VAULT_BYTES)) {
        throw new Error('Ada file yang melebihi batas 101 MB. Hapus file tersebut dari pilihan.');
      }

      setBusy(true);
      let succeeded = 0;
      const failed = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        setProgress(`Mendekripsi: ${file.name}`, i, files.length);
        setStatus(`Memproses file ${i + 1} dari ${files.length}: ${file.name}`);
        try {
          await decryptOneFile(file, password);
          succeeded += 1;
        } catch (error) {
          failed.push(`${file.name}: ${readableCryptoError(error, 'gagal')}`);
        }
        setProgress(`Selesai: ${file.name}`, i + 1, files.length);
      }

      if (failed.length) {
        const summary = failed.slice(0, 3).join(' | ');
        setStatus(`${succeeded} file berhasil dipulihkan; ${failed.length} gagal. ${summary}`, 'warning');
      } else {
        setStatus(`${succeeded} file berhasil didekripsi dan dipulihkan.`, 'success');
      }
    } catch (error) {
      setStatus(readableCryptoError(error, 'Dekripsi file gagal.'), 'error');
    } finally {
      setBusy(false);
      window.setTimeout(hideProgress, 1500);
    }
  }

  function readableCryptoError(error, fallback) {
    if (error && error.name === 'OperationError') {
      return 'Autentikasi gagal: password salah, data rusak, atau isi Vault telah dimodifikasi.';
    }
    if (error && error.name === 'NotSupportedError') {
      return 'Browser tidak mendukung algoritma kriptografi yang dibutuhkan.';
    }
    return (error && error.message) ? error.message : fallback;
  }

  // ----------------------------------------------------------------------
  // Clipboard
  // ----------------------------------------------------------------------
  async function copyText(text, successMessage) {
    if (!text) {
      setStatus('Tidak ada hasil untuk disalin.', 'warning');
      return false;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('Clipboard API tidak tersedia.');
      }
      setStatus(successMessage, 'success');
      return true;
    } catch {
      const temporary = document.createElement('textarea');
      temporary.value = text;
      temporary.setAttribute('readonly', '');
      temporary.className = 'clipboard-fallback';
      document.body.appendChild(temporary);
      temporary.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      temporary.remove();
      setStatus(copied ? successMessage : 'Clipboard diblokir browser. Pilih teks lalu salin secara manual.', copied ? 'success' : 'warning');
      return copied;
    }
  }

  // ----------------------------------------------------------------------
  // Password generator dan indikator password
  // ----------------------------------------------------------------------
  function secureRandomInt(max) {
    if (!Number.isInteger(max) || max < 1 || max > 0x100000000) {
      throw new Error('Rentang angka acak tidak valid.');
    }
    const ceiling = Math.floor(0x100000000 / max) * max;
    const sample = new Uint32Array(1);
    do { window.crypto.getRandomValues(sample); } while (sample[0] >= ceiling);
    return sample[0] % max;
  }

  function generatePassword(length, selectedGroups) {
    requireCrypto();
    const groups = {
      upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
      lower: 'abcdefghijkmnopqrstuvwxyz',
      number: '23456789',
      symbol: '!@#$%^&*()-_=+[]{}?'
    };
    const enabled = selectedGroups.map((name) => groups[name]).filter(Boolean);
    if (enabled.length === 0) throw new Error('Pilih setidaknya satu kelompok karakter.');
    if (!Number.isInteger(length) || length < 12 || length > 64) {
      throw new Error('Panjang password harus antara 12 dan 64 karakter.');
    }
    if (length < enabled.length) throw new Error('Panjang password tidak cukup untuk semua kelompok karakter yang dipilih.');

    const all = enabled.join('');
    const chars = enabled.map((group) => group[secureRandomInt(group.length)]);
    while (chars.length < length) chars.push(all[secureRandomInt(all.length)]);
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = secureRandomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  function assessPassword(password) {
    if (!password) return { score: 0, label: 'Belum ada password' };
    const tests = [
      [...password].length >= 12,
      [...password].length >= 16,
      [...password].length >= 24,
      /[a-z]/.test(password) && /[A-Z]/.test(password),
      /\d/.test(password),
      /[^A-Za-z0-9]/.test(password)
    ];
    let score = tests.filter(Boolean).length;
    const lower = password.toLowerCase();
    const weakPatterns = [
      'password', 'admin', 'qwerty', 'letmein', 'welcome',
      '123456', 'abcdef', 'iloveyou'
    ];
    const repeated = /(.)\1{3,}/u.test(password);
    const obviousSequence = /(?:0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer)/i.test(password);
    if (weakPatterns.some((pattern) => lower.includes(pattern)) || repeated || obviousSequence) {
      score = Math.min(score, 2);
    }
    score = Math.min(5, score);
    const labels = ['Sangat lemah', 'Lemah', 'Cukup', 'Baik', 'Kuat', 'Sangat kuat'];
    return { score, label: labels[score] };
  }

  function updatePasswordStrength() {
    const assessment = assessPassword($('secretKey').value);
    $('strengthLabel').textContent = assessment.label;
    const bars = document.querySelectorAll('.strength-meter span');
    bars.forEach((bar, index) => {
      bar.classList.toggle('active', index < assessment.score);
      bar.classList.toggle('medium', assessment.score > 0 && assessment.score <= 2 && index < assessment.score);
      bar.classList.toggle('weak', assessment.score === 1 && index === 0);
    });
  }

  // ----------------------------------------------------------------------
  // Hash & Integrity user interface
  // ----------------------------------------------------------------------
  function setHashSource(source) {
    const useText = source === 'text';
    $('hashTextTab').classList.toggle('active', useText);
    $('hashFileTab').classList.toggle('active', !useText);
    $('hashTextTab').setAttribute('aria-selected', String(useText));
    $('hashFileTab').setAttribute('aria-selected', String(!useText));
    $('hashTextSource').hidden = !useText;
    $('hashFileSource').hidden = useText;
  }

  async function calculateHash() {
    if (busy) return;
    let bytes;
    try {
      requireCrypto();
      const algorithm = $('hashAlgorithm').value;
      setBusy(true);
      setStatus(`Menghitung fingerprint ${algorithm}...`);

      if (!$('hashTextSource').hidden) {
        bytes = UTF8.encode($('hashTextInput').value);
        if (bytes.length > MAX_TEXT_BYTES) throw new Error('Input teks untuk hash melebihi 10 MB.');
      } else {
        const file = $('hashFileInput').files[0];
        if (!file) throw new Error('Pilih file yang ingin di-hash.');
        if (file.size > MAX_FILE_BYTES) throw new Error('Ukuran file hash melebihi batas 100 MB.');
        bytes = new Uint8Array(await file.arrayBuffer());
      }

      currentHash = await digestHex(bytes, algorithm);
      currentHashAlgorithm = algorithm;
      $('hashResult').value = currentHash;
      $('hashAlgorithmLabel').textContent = algorithm;
      $('compareResult').textContent = 'Fingerprint berhasil dibuat; belum dibandingkan.';
      $('compareResult').className = 'compare-result';
      setStatus(`${algorithm} berhasil dihitung. Fingerprint berukuran ${currentHash.length * 4} bit.`, 'success');
    } catch (error) {
      currentHash = '';
      $('hashResult').value = '';
      setStatus(readableCryptoError(error, 'Perhitungan hash gagal.'), 'error');
    } finally {
      if (bytes) bytes.fill(0);
      setBusy(false);
    }
  }

  function compareHash() {
    const expected = $('expectedHash').value.trim().replace(/^0x/i, '').replace(/\s+/g, '').toLowerCase();
    const result = $('compareResult');
    if (!currentHash) {
      result.textContent = 'Hitung hash terlebih dahulu.';
      result.className = 'compare-result';
      return;
    }
    if (!expected) {
      result.textContent = 'Masukkan fingerprint pembanding.';
      result.className = 'compare-result';
      return;
    }
    const matches = constantTimeStringEqual(currentHash.toLowerCase(), expected);
    result.textContent = matches
      ? `COCOK — fingerprint ${currentHashAlgorithm} sama.`
      : `TIDAK COCOK — fingerprint ${currentHashAlgorithm} berbeda.`;
    result.className = `compare-result ${matches ? 'pass' : 'fail'}`;
    setStatus(matches ? 'Verifikasi hash berhasil: fingerprint sama.' : 'Verifikasi hash gagal: fingerprint berbeda.', matches ? 'success' : 'error');
  }

  function clearHash() {
    $('hashTextInput').value = '';
    $('hashFileInput').value = '';
    $('hashFileInfo').textContent = 'Belum ada file dipilih. Maksimum 100 MB.';
    $('hashResult').value = '';
    $('expectedHash').value = '';
    $('compareResult').textContent = 'Belum diverifikasi.';
    $('compareResult').className = 'compare-result';
    currentHash = '';
    setStatus('Kolom hash telah dibersihkan.');
  }

  // ----------------------------------------------------------------------
  // Random bytes generator
  // ----------------------------------------------------------------------
  function generateRandomBytes() {
    try {
      const length = Number.parseInt($('randomByteLength').value, 10);
      if (!Number.isInteger(length) || length < 1 || length > 64) {
        throw new Error('Jumlah byte harus antara 1 dan 64.');
      }
      const bytes = randomBytes(length);
      const format = $('randomByteFormat').value;
      let output;
      if (format === 'hex') {
        output = bytesToHex(bytes);
      } else if (format === 'base64') {
        output = bytesToBase64(bytes);
      } else {
        output = bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      }
      $('randomBytesOutput').value = output;
      bytes.fill(0);
      setStatus(`${length} byte acak kriptografis berhasil dibuat.`, 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  function generateRandomPasswordFromTool() {
    try {
      const length = Number.parseInt($('randomPasswordLength').value, 10);
      const groups = [];
      if ($('useUppercase').checked) groups.push('upper');
      if ($('useLowercase').checked) groups.push('lower');
      if ($('useNumbers').checked) groups.push('number');
      if ($('useSymbols').checked) groups.push('symbol');
      $('randomPasswordOutput').value = generatePassword(length, groups);
      $('randomPasswordOutput').type = 'text';
      $('toggleRandomPassword').textContent = 'Sembunyikan';
      setStatus('Password acak dibuat menggunakan crypto.getRandomValues(). Simpan ke password manager.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  // ----------------------------------------------------------------------
  // Ringkasan kesiapan browser (status ringkas, bukan halaman Security Audit)
  // ----------------------------------------------------------------------
  function makeEnvironmentCheck(title, status) {
    return { title, status };
  }

  function runEnvironmentStatus() {
    const checks = [];
    const secure = Boolean(window.isSecureContext);
    checks.push(makeEnvironmentCheck('Secure context', secure ? 'pass' : 'fail'));

    const webCrypto = Boolean(window.crypto && window.crypto.subtle);
    checks.push(makeEnvironmentCheck('Web Crypto API', webCrypto ? 'pass' : 'fail'));

    let randomAvailable = false;
    try {
      randomAvailable = Boolean(window.crypto && window.crypto.getRandomValues);
      if (randomAvailable) window.crypto.getRandomValues(new Uint8Array(8));
    } catch { randomAvailable = false; }
    checks.push(makeEnvironmentCheck('CSPRNG', randomAvailable ? 'pass' : 'fail'));

    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const cspValue = csp ? csp.content : '';
    const cspOk = cspValue.includes("script-src 'self'") && cspValue.includes("connect-src 'none'");
    checks.push(makeEnvironmentCheck('Content Security Policy', cspOk ? 'pass' : 'warn'));

    const externalScripts = Array.from(document.scripts).filter((script) => {
      if (!script.src) return false;
      try { return new URL(script.src, window.location.href).origin !== window.location.origin; }
      catch { return true; }
    });
    checks.push(makeEnvironmentCheck('Local scripts', externalScripts.length === 0 ? 'pass' : 'warn'));

    const failed = checks.filter((item) => item.status === 'fail').length;
    const warnings = checks.filter((item) => item.status === 'warn').length;
    const summary = $('environmentSummary');
    summary.className = 'pill ' + (failed ? 'fail' : (warnings ? 'warn' : 'pass'));
    summary.textContent = failed ? `${failed} perlu perhatian` : (warnings ? `${warnings} catatan` : 'Browser siap');

    const quick = $('browserChecks');
    quick.replaceChildren();
    checks.forEach((check) => {
      const item = document.createElement('span');
      item.className = `environment-item ${check.status}`;
      item.textContent = check.title;
      quick.append(item);
    });
  }

  // ----------------------------------------------------------------------
  // Navigasi tab dan event binding
  // ----------------------------------------------------------------------
  function setMainTab(name) {
    document.querySelectorAll('.main-tab').forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.main-panel').forEach((panel) => {
      panel.hidden = panel.id !== `panel-${name}`;
    });
  }

  function setVaultMode(mode) {
    const textMode = mode === 'text';
    $('textModeTab').classList.toggle('active', textMode);
    $('fileModeTab').classList.toggle('active', !textMode);
    $('textModeTab').setAttribute('aria-selected', String(textMode));
    $('fileModeTab').setAttribute('aria-selected', String(!textMode));
    $('textModePanel').hidden = !textMode;
    $('fileModePanel').hidden = textMode;
  }

  function bindEvents() {
    document.querySelectorAll('.main-tab').forEach((tab) => {
      tab.addEventListener('click', () => setMainTab(tab.dataset.tab));
    });

    $('backLink').addEventListener('click', (event) => {
      if (window.history.length > 1) {
        event.preventDefault();
        window.history.back();
      }
    });

    $('textModeTab').addEventListener('click', () => setVaultMode('text'));
    $('fileModeTab').addEventListener('click', () => setVaultMode('file'));
    $('hashTextTab').addEventListener('click', () => setHashSource('text'));
    $('hashFileTab').addEventListener('click', () => setHashSource('file'));

    $('togglePassword').addEventListener('click', () => {
      const input = $('secretKey');
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      $('togglePassword').textContent = visible ? 'Sembunyikan' : 'Lihat';
      $('togglePassword').setAttribute('aria-label', visible ? 'Sembunyikan password' : 'Tampilkan password');
    });

    $('clearKey').addEventListener('click', () => {
      $('secretKey').value = '';
      $('confirmPassword').value = '';
      $('secretKey').type = 'password';
      $('togglePassword').textContent = 'Lihat';
      updatePasswordStrength();
      setStatus('Password dan konfirmasi telah dibersihkan dari kolom input.');
    });

    $('generatePassword').addEventListener('click', () => {
      try {
        const generated = generatePassword(24, ['upper', 'lower', 'number', 'symbol']);
        $('secretKey').value = generated;
        $('confirmPassword').value = generated;
        $('secretKey').type = 'text';
        $('togglePassword').textContent = 'Sembunyikan';
        updatePasswordStrength();
        setStatus('Password acak 24 karakter dibuat dan disalin ke kolom konfirmasi. Simpan dengan password manager.', 'success');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    $('secretKey').addEventListener('input', updatePasswordStrength);
    $('encryptTextBtn').addEventListener('click', encryptText);
    $('decryptTextBtn').addEventListener('click', decryptText);
    $('encryptFilesBtn').addEventListener('click', encryptFiles);
    $('decryptFilesBtn').addEventListener('click', decryptFiles);

    $('inputText').addEventListener('input', () => {
      $('inputCount').textContent = `${$('inputText').value.length.toLocaleString('id-ID')} karakter`;
    });
    $('copyOutputBtn').addEventListener('click', () => copyText($('outputText').value, 'Output berhasil disalin ke clipboard.'));
    $('downloadOutputBtn').addEventListener('click', () => {
      if (!$('outputText').value) {
        setStatus('Belum ada output untuk diunduh.', 'warning');
        return;
      }
      const output = $('outputText').value;
      const isEncryptedVault = /^TVLT2\./i.test(output);
      const filename = isEncryptedVault ? 'hasil-crypto-vault.vault' : 'hasil-dekripsi.txt';
      downloadText(output, filename);
      setStatus(`Output diunduh sebagai ${filename}.`, 'success');
    });
    $('clearTextBtn').addEventListener('click', () => {
      $('inputText').value = '';
      $('outputText').value = '';
      $('inputCount').textContent = '0 karakter';
      setStatus('Kolom input dan output teks telah dibersihkan.');
    });

    $('filesToEncrypt').addEventListener('change', () => updateFileList('filesToEncrypt', 'encryptFilesInfo'));
    $('filesToDecrypt').addEventListener('change', () => updateFileList('filesToDecrypt', 'decryptFilesInfo'));
    $('hashFileInput').addEventListener('change', () => {
      const file = $('hashFileInput').files[0];
      $('hashFileInfo').textContent = file ? `${file.name} · ${formatBytes(file.size)}` : 'Belum ada file dipilih. Maksimum 100 MB.';
    });

    $('hashAlgorithm').addEventListener('change', () => {
      $('hashAlgorithmLabel').textContent = $('hashAlgorithm').value;
      currentHash = '';
      $('hashResult').value = '';
      $('compareResult').textContent = 'Algoritma berubah. Hitung ulang hash sebelum verifikasi.';
    });
    $('calculateHashBtn').addEventListener('click', calculateHash);
    $('compareHashBtn').addEventListener('click', compareHash);
    $('clearHashBtn').addEventListener('click', clearHash);
    $('copyHashBtn').addEventListener('click', () => copyText($('hashResult').value, 'Fingerprint hash berhasil disalin.'));

    $('randomPasswordLength').addEventListener('input', () => {
      $('randomPasswordLengthLabel').textContent = `${$('randomPasswordLength').value} karakter`;
    });
    $('createRandomPasswordBtn').addEventListener('click', generateRandomPasswordFromTool);
    $('copyRandomPasswordBtn').addEventListener('click', () => copyText($('randomPasswordOutput').value, 'Password berhasil disalin.'));
    $('toggleRandomPassword').addEventListener('click', () => {
      const field = $('randomPasswordOutput');
      const visible = field.type === 'password';
      field.type = visible ? 'text' : 'password';
      $('toggleRandomPassword').textContent = visible ? 'Sembunyikan' : 'Lihat';
    });
    $('createRandomBytesBtn').addEventListener('click', generateRandomBytes);
    $('copyRandomBytesBtn').addEventListener('click', () => copyText($('randomBytesOutput').value, 'Random bytes berhasil disalin.'));

  }

  function initialize() {
    bindEvents();
    updatePasswordStrength();
    runEnvironmentStatus();
    try {
      requireCrypto();
      setStatus('Siap. Operasi enkripsi, hash, dan random generator diproses secara lokal di browser.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
      document.querySelectorAll('.operation').forEach((button) => { button.disabled = true; });
    }
  }

  return { initialize };
})();

document.addEventListener('DOMContentLoaded', CryptoVault.initialize);