/* FileWerk - seluruh pemrosesan dilakukan di browser pengguna. */

(() => {
  'use strict';

  // Worker wajib berasal dari versi dan CDN yang sama dengan PDF.js.
  if (window.pdfjsLib) {
    const pdfScript = document.getElementById('pdfjsScript');
    const loadedFromCdnJs = pdfScript && pdfScript.src.includes('cdnjs.cloudflare.com');
    pdfjsLib.GlobalWorkerOptions.workerSrc = loadedFromCdnJs
      ? 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      : 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  const $ = (id) => document.getElementById(id);
  const state = {
    photos: [],
    compressPdf: null,
    pdfImage: null,
    imagePdf: [],
    toastTimer: null
  };

  const toolMeta = {
    photo: { eyebrow: 'IMAGE TOOLS', title: 'Kompres Foto', description: 'Kurangi ukuran foto dengan tetap menjaga kualitas visualnya.' },
    'pdf-compress': { eyebrow: 'PDF TOOLS', title: 'Kompres PDF', description: 'Kecilkan ukuran dokumen dengan mengatur kualitas dan resolusi halaman.' },
    'pdf-image': { eyebrow: 'PDF CONVERTER', title: 'PDF ke Gambar', description: 'Ubah setiap halaman PDF menjadi gambar JPG atau PNG.' },
    'image-pdf': { eyebrow: 'PDF CONVERTER', title: 'Gambar ke PDF', description: 'Gabungkan satu atau beberapa gambar menjadi satu dokumen PDF.' },
  };

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
  }

  function safeBaseName(name) {
    return (name || 'file')
      .replace(/\.[^.]+$/, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 100) || 'file';
  }

  function showToast(message, type = 'info') {
    const toast = $('toast');
    const text = $('toastText');
    const icon = toast.querySelector('svg');
    text.textContent = message;
    if (icon && window.lucide && typeof lucide.createIcons === 'function') {
      icon.setAttribute('data-lucide', type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle-2' : 'info');
      lucide.createIcons();
    }
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
  }

  function setProgress(prefix, percent, message) {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    $(`${prefix}Progress`).classList.remove('hidden');
    $(`${prefix}ProgressText`).textContent = message;
    $(`${prefix}ProgressPercent`).textContent = `${value}%`;
    $(`${prefix}ProgressBar`).style.width = `${value}%`;
  }

  function resetProgress(prefix) {
    $(`${prefix}Progress`).classList.add('hidden');
    $(`${prefix}ProgressBar`).style.width = '0%';
    $(`${prefix}ProgressPercent`).textContent = '0%';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function showResult(containerId, { title = 'Berhasil diproses', description = '', stats = [], blob, filename, buttonText = 'Unduh hasil' }) {
    const container = $(containerId);
    container.replaceChildren();
    const titleRow = document.createElement('div');
    titleRow.className = 'result-title';
    titleRow.innerHTML = '<i data-lucide="check-circle-2"></i>';
    const titleText = document.createElement('span');
    titleText.textContent = title;
    titleRow.appendChild(titleText);
    container.appendChild(titleRow);

    if (description) {
      const desc = document.createElement('p');
      desc.className = 'result-desc';
      desc.textContent = description;
      container.appendChild(desc);
    }

    if (stats.length) {
      const statRow = document.createElement('div');
      statRow.className = 'result-stats';
      stats.forEach(({ label, value }) => {
        const pill = document.createElement('span');
        pill.className = 'stat-pill';
        pill.append(document.createTextNode(`${label} `));
        const strong = document.createElement('b');
        strong.textContent = value;
        pill.appendChild(strong);
        statRow.appendChild(pill);
      });
      container.appendChild(statRow);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'download-button';
    button.innerHTML = '<i data-lucide="download"></i>';
    const buttonLabel = document.createElement('span');
    buttonLabel.textContent = buttonText;
    button.appendChild(buttonLabel);
    button.addEventListener('click', () => downloadBlob(blob, filename));
    container.appendChild(button);
    container.classList.remove('hidden');
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  }

  function fileIcon(type = 'file') {
    if (type === 'pdf') return 'file-text';
    if (type === 'image') return 'image';
    return 'file';
  }

  function makeFileSummary(file, type = 'pdf') {
    const wrap = document.createElement('div');
    wrap.className = 'file-summary';
    wrap.innerHTML = `<span class="file-type-icon"><i data-lucide="${fileIcon(type)}"></i></span>`;
    const info = document.createElement('div');
    info.className = 'file-info';
    const name = document.createElement('b');
    name.textContent = file.name;
    const size = document.createElement('small');
    size.textContent = formatBytes(file.size);
    info.append(name, size);
    wrap.appendChild(info);
    return wrap;
  }

  function renderSingleSummary(containerId, file, type, removeButtonId) {
    const container = $(containerId);
    container.replaceChildren();
    if (file) {
      container.appendChild(makeFileSummary(file, type));
      container.classList.remove('hidden');
      $(removeButtonId).classList.remove('hidden');
    } else {
      container.classList.add('hidden');
      $(removeButtonId).classList.add('hidden');
    }
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  }

  function renderFileList(files, wrapId, listId, onRemove, type = 'image') {
    const wrap = $(wrapId);
    const list = $(listId);
    list.replaceChildren();
    wrap.classList.toggle('hidden', files.length === 0);
    files.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `<span class="file-type-icon"><i data-lucide="${fileIcon(type)}"></i></span>`;
      const info = document.createElement('div');
      info.className = 'file-info';
      const name = document.createElement('b');
      name.textContent = file.name;
      const size = document.createElement('small');
      size.textContent = formatBytes(file.size);
      info.append(name, size);
      const remove = document.createElement('button');
      remove.className = 'remove-file';
      remove.type = 'button';
      remove.setAttribute('aria-label', `Hapus ${file.name}`);
      remove.innerHTML = '<i data-lucide="x"></i>';
      remove.addEventListener('click', () => onRemove(index));
      row.append(info, remove);
      list.appendChild(row);
    });
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  }

  function addFiles(existing, incoming) {
    const combined = [...existing];
    for (const file of incoming) {
      const duplicate = combined.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
      if (!duplicate) combined.push(file);
    }
    return combined;
  }

  function isPdf(file) {
    return file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  }

  function checkPdfRenderer() {
    if (!window.pdfjsLib) {
      throw new Error('Pustaka pembaca PDF belum berhasil dimuat. Periksa koneksi internet, lalu muat ulang halaman.');
    }
  }

  function checkPdfBuilder() {
    if (!window.PDFLib) {
      throw new Error('Pustaka pembuat PDF belum berhasil dimuat. Periksa koneksi internet, lalu muat ulang halaman.');
    }
  }

  async function openPdf(file) {
    checkPdfRenderer();
    if (!isPdf(file)) throw new Error('File yang dipilih harus berformat PDF.');
    const data = new Uint8Array(await file.arrayBuffer());
    // Jangan jalankan evaluator PDF; worker PDF.js tetap bekerja di luar main thread.
    return pdfjsLib.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  }

  function updateDependencyStatus() {
    const banner = $('dependencyBanner');
    const text = $('dependencyText');
    if (!banner || !text) return;

    const missingCore = [];
    const missingOptional = [];
    if (!window.pdfjsLib) missingCore.push('PDF.js');
    if (!window.PDFLib) missingCore.push('PDF-Lib');
    if (!window.JSZip) missingCore.push('ZIP');
    if (!window.heic2any) missingOptional.push('HEIC/HEIF');
    if (!window.UTIF) missingOptional.push('TIFF');

    banner.classList.remove('is-warning', 'is-error');
    if (missingCore.length) {
      banner.classList.add('is-error');
      text.textContent = `Pustaka ${missingCore.join(', ')} belum siap. Fitur terkait tidak dapat dipakai; periksa koneksi internet dan muat ulang halaman.`;
      return;
    }
    if (missingOptional.length) {
      banner.classList.add('is-warning');
      text.textContent = `Alat utama siap. Decoder ${missingOptional.join(' dan ')} belum tersedia; format tersebut tidak dapat diproses saat ini.`;
      return;
    }
    text.textContent = 'Semua pustaka siap. File diproses langsung di browser perangkat Anda.';
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Browser gagal membuat gambar hasil.'));
        // Browser dapat diam-diam mengganti format yang tidak didukung menjadi PNG.
        if (mime && blob.type !== mime) {
          const requested = mime.split('/')[1]?.toUpperCase() || mime;
          return reject(new Error(`Browser ini tidak mendukung ekspor ${requested}. Pilih JPG atau PNG.`));
        }
        resolve(blob);
      }, mime, quality);
    });
  }

  function getExtension(name) {
    const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
  }

  async function fileToCanvas(file) {
    const extension = getExtension(file.name);
    let sourceBlob = file;

    if (['heic', 'heif'].includes(extension) || /image\/hei[cf]/i.test(file.type)) {
      if (typeof window.heic2any !== 'function') {
        throw new Error('Konverter HEIC belum dimuat. Periksa koneksi internet atau gunakan JPG/PNG/WebP.');
      }
      const converted = await heic2any({ blob: file, toType: 'image/png' });
      sourceBlob = Array.isArray(converted) ? converted[0] : converted;
    }

    if (['tif', 'tiff'].includes(extension) || /image\/tiff/i.test(file.type)) {
      if (!window.UTIF) throw new Error('Decoder TIFF belum dimuat.');
      const buffer = await sourceBlob.arrayBuffer();
      const ifds = UTIF.decode(buffer);
      if (!ifds || !ifds.length) throw new Error('Data TIFF tidak dapat dibaca.');
      UTIF.decodeImage(buffer, ifds[0]);
      const rgba = UTIF.toRGBA8(ifds[0]);
      const canvas = document.createElement('canvas');
      canvas.width = ifds[0].width;
      canvas.height = ifds[0].height;
      const context = canvas.getContext('2d', { willReadFrequently: false });
      const imageData = new ImageData(new Uint8ClampedArray(rgba), canvas.width, canvas.height);
      context.putImageData(imageData, 0, 0);
      return { canvas, sourceMime: 'image/tiff' };
    }

    let bitmap;
    try {
      if ('createImageBitmap' in window) bitmap = await createImageBitmap(sourceBlob, { imageOrientation: 'from-image' });
    } catch (_) {
      bitmap = null;
    }

    const canvas = document.createElement('canvas');
    let width;
    let height;
    const context = canvas.getContext('2d');

    if (bitmap) {
      width = bitmap.width;
      height = bitmap.height;
      canvas.width = width;
      canvas.height = height;
      context.drawImage(bitmap, 0, 0);
      bitmap.close?.();
    } else {
      const url = URL.createObjectURL(sourceBlob);
      try {
        const image = await new Promise((resolve, reject) => {
          const element = new Image();
          element.onload = () => resolve(element);
          element.onerror = () => reject(new Error(`Format ${extension ? extension.toUpperCase() : 'gambar'} tidak dapat dibaca oleh browser ini.`));
          element.src = url;
        });
        width = image.naturalWidth;
        height = image.naturalHeight;
        canvas.width = width;
        canvas.height = height;
        context.drawImage(image, 0, 0);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    if (!canvas.width || !canvas.height) throw new Error('Gambar kosong atau tidak dapat dibaca.');
    return { canvas, sourceMime: file.type || '' };
  }

  function resizeCanvas(sourceCanvas, maxDimension) {
    if (!maxDimension || Math.max(sourceCanvas.width, sourceCanvas.height) <= maxDimension) return sourceCanvas;
    const ratio = maxDimension / Math.max(sourceCanvas.width, sourceCanvas.height);
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(sourceCanvas.width * ratio));
    output.height = Math.max(1, Math.round(sourceCanvas.height * ratio));
    const context = output.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(sourceCanvas, 0, 0, output.width, output.height);
    return output;
  }

  function resolvePhotoMime(file, requested) {
    if (requested !== 'original') return requested;
    const extension = getExtension(file.name);
    if (['png'].includes(extension) || file.type === 'image/png') return 'image/png';
    if (['webp'].includes(extension) || file.type === 'image/webp') return 'image/webp';
    return 'image/jpeg';
  }

  function mimeExtension(mime) {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    return 'jpg';
  }

  function uniqueFilename(candidate, usedNames) {
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    const dot = candidate.lastIndexOf('.');
    const base = dot > 0 ? candidate.slice(0, dot) : candidate;
    const extension = dot > 0 ? candidate.slice(dot) : '';
    let counter = 2;
    let result = `${base}_${counter}${extension}`;
    while (usedNames.has(result)) {
      counter += 1;
      result = `${base}_${counter}${extension}`;
    }
    usedNames.add(result);
    return result;
  }

  // Navigation antar alat.
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.tool;
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item === button));
      document.querySelectorAll('.tool-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === key));
      $('eyebrow').textContent = toolMeta[key].eyebrow;
      $('pageTitle').textContent = toolMeta[key].title;
      $('pageDescription').textContent = toolMeta[key].description;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Tombol kembali tetap berupa elemen <a>; riwayat browser menjadi prioritas jika tersedia.
  $('backLink').addEventListener('click', (event) => {
    if (window.history.length > 1) {
      event.preventDefault();
      window.history.back();
    }
  });

  // Drag and drop bersama untuk seluruh area unggah.
  function setupDropzone(zoneId, inputId, onFiles) {
    const zone = $(zoneId);
    const input = $(inputId);
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('drag-over');
      if (event.dataTransfer?.files?.length) onFiles(Array.from(event.dataTransfer.files));
    });
    input.addEventListener('change', () => {
      if (input.files?.length) onFiles(Array.from(input.files));
      input.value = '';
    });
  }

  // 1. KOMPRES FOTO
  function refreshPhotoList() {
    renderFileList(state.photos, 'photoFilesWrap', 'photoFileList', (index) => {
      state.photos.splice(index, 1);
      refreshPhotoList();
    });
    $('photoProcess').disabled = state.photos.length === 0;
    $('photoResult').classList.add('hidden');
  }

  setupDropzone('photoDropzone', 'photoInput', (files) => {
    const images = files.filter((file) => file.type.startsWith('image/') || /\.(heic|heif|tif|tiff|bmp|svg|avif)$/i.test(file.name));
    if (!images.length) return showToast('Pilih file gambar yang didukung.', 'error');
    state.photos = addFiles(state.photos, images);
    refreshPhotoList();
  });

  $('clearPhotos').addEventListener('click', () => { state.photos = []; refreshPhotoList(); });
  $('photoQuality').addEventListener('input', () => { $('photoQualityValue').textContent = `${$('photoQuality').value}%`; });

  $('photoProcess').addEventListener('click', async () => {
    if (!state.photos.length) return;
    const button = $('photoProcess');
    const originalLabel = button.innerHTML;
    const quality = Number($('photoQuality').value) / 100;
    const maxDimension = Number($('photoMaxDim').value);
    const requestedFormat = $('photoFormat').value;
    const outputs = [];
    const usedNames = new Set();
    let totalBefore = 0;
    let totalAfter = 0;
    button.disabled = true;
    $('photoResult').classList.add('hidden');
    try {
      for (let index = 0; index < state.photos.length; index++) {
        const file = state.photos[index];
        setProgress('photo', (index / state.photos.length) * 100, `Mengompres ${file.name}...`);
        const { canvas: originalCanvas } = await fileToCanvas(file);
        const canvas = resizeCanvas(originalCanvas, maxDimension);
        const mime = resolvePhotoMime(file, requestedFormat);
        if (mime === 'image/jpeg') {
          const flattened = document.createElement('canvas');
          flattened.width = canvas.width;
          flattened.height = canvas.height;
          const flattenedContext = flattened.getContext('2d');
          flattenedContext.fillStyle = '#ffffff';
          flattenedContext.fillRect(0, 0, flattened.width, flattened.height);
          flattenedContext.drawImage(canvas, 0, 0);
          const blob = await canvasToBlob(flattened, mime, quality);
          const name = uniqueFilename(`${safeBaseName(file.name)}_compressed.${mimeExtension(mime)}`, usedNames);
          outputs.push({ blob, name, before: file.size, after: blob.size, width: canvas.width, height: canvas.height });
        } else {
          const blob = await canvasToBlob(canvas, mime, quality);
          const name = uniqueFilename(`${safeBaseName(file.name)}_compressed.${mimeExtension(mime)}`, usedNames);
          outputs.push({ blob, name, before: file.size, after: blob.size, width: canvas.width, height: canvas.height });
        }
        totalBefore += file.size;
        totalAfter += outputs[outputs.length - 1].after;
        setProgress('photo', ((index + 1) / state.photos.length) * 100, `Selesai ${index + 1} dari ${state.photos.length} foto`);
      }

      let resultBlob;
      let outputName;
      if (outputs.length === 1) {
        resultBlob = outputs[0].blob;
        outputName = outputs[0].name;
      } else {
        if (!window.JSZip) throw new Error('Library ZIP belum berhasil dimuat. Periksa koneksi internet.');
        const zip = new JSZip();
        outputs.forEach((item) => zip.file(item.name, item.blob));
        resultBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        outputName = 'hasil_kompres_foto.zip';
      }
      const savings = totalBefore ? ((totalBefore - totalAfter) / totalBefore) * 100 : 0;
      const stats = [
        { label: 'Ukuran awal', value: formatBytes(totalBefore) },
        { label: 'Ukuran hasil gambar', value: formatBytes(totalAfter) },
        { label: 'Perubahan ukuran', value: `${savings >= 0 ? 'hemat ' : 'bertambah '}${Math.abs(savings).toFixed(1)}%` }
      ];
      showResult('photoResult', {
        title: 'Foto berhasil dikompres',
        description: `${outputs.length} foto selesai diproses. Dimensi dan ukuran dapat berbeda sesuai pengaturan kompresi.`,
        stats,
        blob: resultBlob,
        filename: outputName,
        buttonText: outputs.length > 1 ? 'Unduh semua foto (ZIP)' : 'Unduh foto hasil kompresi'
      });
      showToast('Kompresi foto selesai.', 'success');
    } catch (error) {
      showToast(error.message || 'Gagal mengompres foto.', 'error');
    } finally {
      resetProgress('photo');
      button.disabled = state.photos.length === 0;
      button.innerHTML = originalLabel;
      if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    }
  });

  // 2. KOMPRES PDF
  setupDropzone('compressDropzone', 'compressInput', (files) => {
    const file = files.find(isPdf);
    if (!file) return showToast('Pilih satu file PDF.', 'error');
    state.compressPdf = file;
    renderSingleSummary('compressFileSummary', file, 'pdf', 'removeCompressFile');
    $('compressProcess').disabled = false;
    $('compressResult').classList.add('hidden');
  });
  $('removeCompressFile').addEventListener('click', () => {
    state.compressPdf = null;
    renderSingleSummary('compressFileSummary', null, 'pdf', 'removeCompressFile');
    $('compressProcess').disabled = true;
    $('compressResult').classList.add('hidden');
  });

  $('compressProcess').addEventListener('click', async () => {
    if (!state.compressPdf) return;
    const button = $('compressProcess');
    button.disabled = true;
    $('compressResult').classList.add('hidden');
    const levels = {
      extreme: { dpi: 72, quality: 0.42 },
      high: { dpi: 100, quality: 0.58 },
      medium: { dpi: 144, quality: 0.76 },
      low: { dpi: 200, quality: 0.88 }
    };
    const level = levels[$('pdfCompressLevel').value] || levels.medium;
    let sourcePdf = null;
    try {
      checkPdfBuilder();
      sourcePdf = await openPdf(state.compressPdf);
      const pdf = sourcePdf;
      if (pdf.numPages > 150) throw new Error('Dokumen memiliki lebih dari 150 halaman. Bagi PDF menjadi beberapa bagian terlebih dahulu agar browser tidak kehabisan memori.');
      const outputPdf = await PDFLib.PDFDocument.create();
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        setProgress('compress', ((pageNumber - 1) / pdf.numPages) * 100, `Mengompres halaman ${pageNumber} dari ${pdf.numPages}...`);
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: level.dpi / 72 });
        const cap = 3000;
        const scaleFactor = Math.min(1, cap / Math.max(viewport.width, viewport.height));
        const finalViewport = scaleFactor < 1 ? page.getViewport({ scale: (level.dpi / 72) * scaleFactor }) : viewport;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(finalViewport.width));
        canvas.height = Math.max(1, Math.ceil(finalViewport.height));
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport: finalViewport, background: '#ffffff' }).promise;
        const imageBlob = await canvasToBlob(canvas, 'image/jpeg', level.quality);
        const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
        const embeddedImage = await outputPdf.embedJpg(imageBytes);
        const pageSize = page.getViewport({ scale: 1 });
        const outputPage = outputPdf.addPage([pageSize.width, pageSize.height]);
        outputPage.drawImage(embeddedImage, { x: 0, y: 0, width: pageSize.width, height: pageSize.height });
        canvas.width = 1;
        canvas.height = 1;
        page.cleanup();
        setProgress('compress', (pageNumber / pdf.numPages) * 100, `Selesai ${pageNumber} dari ${pdf.numPages} halaman`);
      }
      const bytes = await outputPdf.save({ useObjectStreams: true, addDefaultPage: false });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const before = state.compressPdf.size;
      const delta = ((before - blob.size) / before) * 100;
      const message = delta >= 0
        ? `PDF selesai dikompres dan ukuran berkurang ${delta.toFixed(1)}%.`
        : `PDF berhasil dibuat, tetapi ukurannya bertambah ${Math.abs(delta).toFixed(1)}%. Coba tingkat kompresi Ekstrem atau file sumber yang berbeda.`;
      showResult('compressResult', {
        title: 'Proses kompres PDF selesai',
        description: message,
        stats: [
          { label: 'Ukuran awal', value: formatBytes(before) },
          { label: 'Ukuran hasil', value: formatBytes(blob.size) },
          { label: 'Jumlah halaman', value: String(pdf.numPages) }
        ],
        blob,
        filename: `${safeBaseName(state.compressPdf.name)}_compressed.pdf`,
        buttonText: 'Unduh PDF hasil kompresi'
      });
      showToast('Proses PDF selesai.', 'success');
    } catch (error) {
      showToast(error.message || 'Gagal mengompres PDF.', 'error');
    } finally {
      if (sourcePdf) {
        try { await sourcePdf.destroy(); } catch (_) { /* abaikan kegagalan pembersihan */ }
      }
      resetProgress('compress');
      button.disabled = !state.compressPdf;
    }
  });

  // Helper render PDF ke satu kanvas, dipakai dua fitur konversi.
  async function renderPdfPage(page, dpi, mime = 'image/jpeg') {
    const scale = dpi / 72;
    const viewport = page.getViewport({ scale });
    const maxEdge = 4200;
    const shrink = Math.min(1, maxEdge / Math.max(viewport.width, viewport.height));
    const finalViewport = shrink < 1 ? page.getViewport({ scale: scale * shrink }) : viewport;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(finalViewport.width));
    canvas.height = Math.max(1, Math.ceil(finalViewport.height));
    const context = canvas.getContext('2d');
    if (mime === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    await page.render({ canvasContext: context, viewport: finalViewport, background: '#ffffff' }).promise;
    return canvas;
  }

  async function outputImagesFromPdf(pdf, pageNumbers, mime, dpi, prefix, progressPrefix) {
    const outputs = [];
    for (let index = 0; index < pageNumbers.length; index++) {
      const pageNumber = pageNumbers[index];
      setProgress(progressPrefix, (index / pageNumbers.length) * 100, `Mengolah halaman ${pageNumber} (${index + 1}/${pageNumbers.length})...`);
      const page = await pdf.getPage(pageNumber);
      const canvas = await renderPdfPage(page, dpi, mime);
      const blob = await canvasToBlob(canvas, mime, 0.92);
      const extension = mime === 'image/png' ? 'png' : 'jpg';
      outputs.push({ blob, name: `${prefix}_halaman_${pageNumber}.${extension}` });
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
      setProgress(progressPrefix, ((index + 1) / pageNumbers.length) * 100, `Selesai ${index + 1} dari ${pageNumbers.length} halaman`);
    }
    return outputs;
  }

  async function makeDownloadFromImages(outputs, zipName) {
    if (outputs.length === 1) return { blob: outputs[0].blob, filename: outputs[0].name, zipped: false };
    if (!window.JSZip) throw new Error('Library ZIP belum berhasil dimuat. Periksa koneksi internet.');
    const zip = new JSZip();
    outputs.forEach((item) => zip.file(item.name, item.blob));
    return { blob: await zip.generateAsync({ type: 'blob', compression: 'STORE' }), filename: zipName, zipped: true };
  }

  // 3. PDF KE GAMBAR
  setupDropzone('pdfImageDropzone', 'pdfImageInput', (files) => {
    const file = files.find(isPdf);
    if (!file) return showToast('Pilih satu file PDF.', 'error');
    state.pdfImage = file;
    renderSingleSummary('pdfImageFileSummary', file, 'pdf', 'removePdfImageFile');
    $('pdfImageProcess').disabled = false;
    $('pdfImageResult').classList.add('hidden');
  });
  $('removePdfImageFile').addEventListener('click', () => {
    state.pdfImage = null;
    renderSingleSummary('pdfImageFileSummary', null, 'pdf', 'removePdfImageFile');
    $('pdfImageProcess').disabled = true;
    $('pdfImageResult').classList.add('hidden');
  });
  $('pdfImageProcess').addEventListener('click', async () => {
    if (!state.pdfImage) return;
    const button = $('pdfImageProcess');
    button.disabled = true;
    $('pdfImageResult').classList.add('hidden');
    let sourcePdf = null;
    try {
      sourcePdf = await openPdf(state.pdfImage);
      const pageCount = sourcePdf.numPages;
      if (pageCount > 150) throw new Error('PDF memiliki lebih dari 150 halaman. Bagi dokumen menjadi beberapa file lalu ulangi proses.');
      const mime = $('pdfImageFormat').value === 'png' ? 'image/png' : 'image/jpeg';
      const dpi = Number($('pdfImageDpi').value);
      const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
      const outputs = await outputImagesFromPdf(sourcePdf, pages, mime, dpi, safeBaseName(state.pdfImage.name), 'pdfImage');
      const result = await makeDownloadFromImages(outputs, `${safeBaseName(state.pdfImage.name)}_gambar.zip`);
      showResult('pdfImageResult', {
        title: 'PDF berhasil dikonversi',
        description: `${pageCount} halaman telah diubah menjadi ${mime === 'image/png' ? 'PNG' : 'JPG'} dengan resolusi ${dpi} DPI.`,
        stats: [{ label: 'Jumlah halaman', value: String(pageCount) }, { label: 'Format', value: mime === 'image/png' ? 'PNG' : 'JPG' }, { label: 'Resolusi', value: `${dpi} DPI` }],
        blob: result.blob,
        filename: result.filename,
        buttonText: result.zipped ? 'Unduh semua gambar (ZIP)' : 'Unduh gambar'
      });
      showToast('PDF berhasil diubah menjadi gambar.', 'success');
    } catch (error) {
      showToast(error.message || 'Gagal mengubah PDF menjadi gambar.', 'error');
    } finally {
      if (sourcePdf) {
        try { await sourcePdf.destroy(); } catch (_) { /* abaikan kegagalan pembersihan */ }
      }
      resetProgress('pdfImage');
      button.disabled = !state.pdfImage;
    }
  });

  // 4. GAMBAR KE PDF
  function refreshImagePdfList() {
    renderFileList(state.imagePdf, 'imagePdfFilesWrap', 'imagePdfFileList', (index) => {
      state.imagePdf.splice(index, 1);
      refreshImagePdfList();
    });
    $('imagePdfProcess').disabled = state.imagePdf.length === 0;
    $('imagePdfResult').classList.add('hidden');
  }
  setupDropzone('imagePdfDropzone', 'imagePdfInput', (files) => {
    const images = files.filter((file) => file.type.startsWith('image/') || /\.(heic|heif|tif|tiff|bmp|svg|avif)$/i.test(file.name));
    if (!images.length) return showToast('Pilih minimal satu file gambar.', 'error');
    state.imagePdf = addFiles(state.imagePdf, images);
    refreshImagePdfList();
  });
  $('clearImagePdf').addEventListener('click', () => { state.imagePdf = []; refreshImagePdfList(); });

  $('imagePdfProcess').addEventListener('click', async () => {
    if (!state.imagePdf.length) return;
    const button = $('imagePdfProcess');
    button.disabled = true;
    $('imagePdfResult').classList.add('hidden');
    try {
      checkPdfBuilder();
      const pdf = await PDFLib.PDFDocument.create();
      const pageMode = $('imagePdfPageSize').value;
      const orientation = $('imagePdfOrientation').value;
      for (let index = 0; index < state.imagePdf.length; index++) {
        const file = state.imagePdf[index];
        setProgress('imagePdf', (index / state.imagePdf.length) * 100, `Memasukkan gambar ${index + 1} dari ${state.imagePdf.length}...`);
        const { canvas } = await fileToCanvas(file);
        const preferPng = getExtension(file.name) === 'png' || file.type === 'image/png';
        const mime = preferPng ? 'image/png' : 'image/jpeg';
        let workCanvas = canvas;
        if (mime === 'image/jpeg') {
          const flattened = document.createElement('canvas');
          flattened.width = canvas.width;
          flattened.height = canvas.height;
          const ctx = flattened.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, flattened.width, flattened.height);
          ctx.drawImage(canvas, 0, 0);
          workCanvas = flattened;
        }
        const blob = await canvasToBlob(workCanvas, mime, 0.92);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const embedded = mime === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        let pageWidth;
        let pageHeight;
        let drawX;
        let drawY;
        let drawWidth;
        let drawHeight;

        if (pageMode === 'original') {
          pageWidth = canvas.width * 0.75;
          pageHeight = canvas.height * 0.75;
          drawX = 0;
          drawY = 0;
          drawWidth = pageWidth;
          drawHeight = pageHeight;
        } else {
          const ratioLandscape = canvas.width > canvas.height;
          const useLandscape = orientation === 'landscape' || (orientation === 'auto' && ratioLandscape);
          pageWidth = useLandscape ? 842 : 595.28;
          pageHeight = useLandscape ? 595.28 : 842;
          const margin = 26;
          const fitScale = Math.min((pageWidth - margin * 2) / embedded.width, (pageHeight - margin * 2) / embedded.height);
          drawWidth = embedded.width * fitScale;
          drawHeight = embedded.height * fitScale;
          drawX = (pageWidth - drawWidth) / 2;
          drawY = (pageHeight - drawHeight) / 2;
        }
        const page = pdf.addPage([pageWidth, pageHeight]);
        page.drawImage(embedded, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });
        canvas.width = 1;
        canvas.height = 1;
        if (workCanvas !== canvas) { workCanvas.width = 1; workCanvas.height = 1; }
        setProgress('imagePdf', ((index + 1) / state.imagePdf.length) * 100, `Selesai ${index + 1} dari ${state.imagePdf.length} gambar`);
      }
      const bytes = await pdf.save({ useObjectStreams: true });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      showResult('imagePdfResult', {
        title: 'PDF berhasil dibuat',
        description: `${state.imagePdf.length} gambar telah digabungkan menjadi satu dokumen PDF.`,
        stats: [{ label: 'Jumlah gambar', value: String(state.imagePdf.length) }, { label: 'Ukuran PDF', value: formatBytes(blob.size) }, { label: 'Ukuran halaman', value: pageMode === 'a4' ? 'A4' : 'Asli' }],
        blob,
        filename: 'gambar_ke_pdf.pdf',
        buttonText: 'Unduh file PDF'
      });
      showToast('Gambar berhasil digabungkan menjadi PDF.', 'success');
    } catch (error) {
      showToast(error.message || 'Gagal membuat PDF dari gambar.', 'error');
    } finally {
      resetProgress('imagePdf');
      button.disabled = state.imagePdf.length === 0;
    }
  });

  // Pemeriksaan awal dan ikon.
  updateDependencyStatus();
  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
})();