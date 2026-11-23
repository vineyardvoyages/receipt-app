(function () {
  'use strict';

  var RECENT_KEY = 'receipts.recent.v1';
  var RECENT_LIMIT = 20;
  var MAX_EDGE = 1600;
  var JPEG_QUALITY = 0.7;
  var cancelled = false;
  var ocrWorker = null;

  var state = {
    blob: null,
    previewUrl: null,
    parsed: null
  };

  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function show(el) {
    el.classList.remove('hidden');
  }

  function hide(el) {
    el.classList.add('hidden');
  }

  function setStatus(node, message, ok) {
    if (!message) {
      hide(node);
      node.textContent = '';
      return;
    }
    node.textContent = message;
    node.classList.toggle('ok', !!ok);
    show(node);
  }

  function loadRecent() {
    try {
      var raw = localStorage.getItem(RECENT_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function saveRecent(list) {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT)));
    } catch (err) {
      // If storage is full, retry without thumbnails.
      try {
        var slim = list.slice(0, RECENT_LIMIT).map(function (item) {
          var copy = Object.assign({}, item);
          delete copy.thumbnail;
          return copy;
        });
        localStorage.setItem(RECENT_KEY, JSON.stringify(slim));
      } catch (err2) { /* give up silently */ }
    }
  }

  function formatSavedWhen(ts) {
    try {
      return new Date(ts).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    } catch (err) {
      return '';
    }
  }

  function renderRecent() {
    var list = loadRecent();
    var empty = els.recentEmpty;
    var ul = els.recentList;
    ul.innerHTML = '';
    if (!list.length) {
      show(empty);
      hide(ul);
      return;
    }
    hide(empty);
    show(ul);
    list.forEach(function (item) {
      var li = document.createElement('li');
      if (item.thumbnail) {
        var img = document.createElement('img');
        img.className = 'thumb';
        img.alt = '';
        img.src = item.thumbnail;
        li.appendChild(img);
      } else {
        var fallback = document.createElement('div');
        fallback.className = 'thumb thumb-fallback';
        fallback.textContent = '▣';
        li.appendChild(fallback);
      }
      var meta = document.createElement('div');
      meta.className = 'recent-meta';
      var name = document.createElement('div');
      name.className = 'recent-name';
      name.textContent = item.filename || '';
      var sub = document.createElement('div');
      sub.className = 'recent-sub';
      var parts = [];
      if (item.savedTo) parts.push(item.savedTo);
      if (item.timestamp) parts.push(formatSavedWhen(item.timestamp));
      sub.textContent = parts.join(' · ');
      meta.appendChild(name);
      meta.appendChild(sub);
      li.appendChild(meta);
      ul.appendChild(li);
    });
  }

  function addRecent(entry) {
    var list = loadRecent().filter(function (item) {
      return item.filename !== entry.filename || item.timestamp !== entry.timestamp;
    });
    list.unshift(entry);
    saveRecent(list);
    renderRecent();
  }

  function revokePreview() {
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = null;
    }
  }

  async function blobToBitmap(blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(blob, { imageOrientation: 'from-image' });
      } catch (err) {
        try {
          return await createImageBitmap(blob);
        } catch (err2) { /* fall through */ }
      }
    }
    return await loadImageBitmapFallback(blob);
  }

  function loadImageBitmapFallback(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read that image.'));
      };
      image.src = url;
    });
  }

  function canvasToJpegBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Could not compress the photo.'));
      }, 'image/jpeg', quality);
    });
  }

  async function compressImage(file) {
    var source = await blobToBitmap(file);
    var width = source.width;
    var height = source.height;
    var longEdge = Math.max(width, height) || 1;
    var scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
    var w = Math.max(1, Math.round(width * scale));
    var h = Math.max(1, Math.round(height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    if (typeof source.close === 'function') source.close();
    return canvasToJpegBlob(canvas, JPEG_QUALITY);
  }

  async function makeThumbnail(blob) {
    try {
      var source = await blobToBitmap(blob);
      var size = 64;
      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');
      var scale = Math.max(size / source.width, size / source.height);
      var w = source.width * scale;
      var h = source.height * scale;
      ctx.drawImage(source, (size - w) / 2, (size - h) / 2, w, h);
      if (typeof source.close === 'function') source.close();
      var thumb = await canvasToJpegBlob(canvas, 0.45);
      if (thumb.size > 8000) return '';
      return await blobToDataUrl(thumb);
    } catch (err) {
      return '';
    }
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function showScreen(name) {
    hide(els.home);
    hide(els.progress);
    hide(els.confirm);
    hide(els.done);
    if (name === 'home') show(els.home);
    if (name === 'progress') show(els.progress);
    if (name === 'confirm') show(els.confirm);
    if (name === 'done') show(els.done);
    window.scrollTo(0, 0);
  }

  function setProgress(title, status, percent) {
    els.progressTitle.textContent = title || 'Reading receipt…';
    els.progressStatus.textContent = status || '';
    var value = Math.max(0, Math.min(100, Number(percent) || 0));
    els.progressFill.style.width = value + '%';
  }

  function currentFilename() {
    var date = els.inputDate.value || '';
    var amount = els.inputAmount.value === '' ? NaN : Number(els.inputAmount.value);
    var currency = els.inputCurrency.value || 'USD';
    var merchant = els.inputMerchant.value || '';
    return ReceiptParser.buildFilename(date, amount, currency, merchant);
  }

  function updateFilenamePreview() {
    els.filenameLive.textContent = currentFilename();
  }

  function markUncertain(fieldEl, hintEl, uncertain, message) {
    fieldEl.classList.toggle('uncertain', !!uncertain);
    hintEl.textContent = uncertain ? (message || 'Please check') : '';
  }

  function fillConfirm(parsed) {
    state.parsed = parsed;
    els.inputMerchant.value = parsed.merchant || '';
    els.inputDate.value = parsed.date || '';
    els.inputAmount.value = parsed.amount == null ? '' : Number(parsed.amount).toFixed(2);
    var currency = parsed.currency || 'USD';
    if (![].some.call(els.inputCurrency.options, function (opt) { return opt.value === currency; })) {
      var opt = document.createElement('option');
      opt.value = currency;
      opt.textContent = currency;
      els.inputCurrency.appendChild(opt);
    }
    els.inputCurrency.value = currency;

    markUncertain(
      els.fieldMerchant,
      els.hintMerchant,
      !parsed.merchant || parsed.merchantConfidence !== 'high',
      parsed.merchant ? 'Please check the merchant' : 'No merchant found — add one if you want it in the filename'
    );
    markUncertain(
      els.fieldDate,
      els.hintDate,
      !parsed.date || parsed.dateConfidence !== 'high',
      parsed.date ? 'Please check the date' : 'No date found — enter one'
    );
    markUncertain(
      els.fieldAmount,
      els.hintAmount,
      parsed.amount == null || parsed.amountConfidence !== 'high',
      parsed.amount == null ? 'No total found — enter one' : 'Please check the total'
    );
    markUncertain(
      els.fieldCurrency,
      els.hintCurrency,
      parsed.currencyConfidence !== 'high',
      'Currency was guessed'
    );
    updateFilenamePreview();
    setStatus(els.confirmStatus, '', false);
    configureSaveButtons();
  }

  function configureSaveButtons() {
    var driveReady = ReceiptDrive.isConfigured();
    els.saveDriveBtn.classList.toggle('hidden', !driveReady);
    els.driveNote.classList.toggle('hidden', driveReady);
    var canShare = typeof navigator.share === 'function';
    els.shareBtn.classList.toggle('hidden', !canShare);
  }

  function namedFile() {
    var filename = currentFilename();
    return new File([state.blob], filename, { type: 'image/jpeg', lastModified: Date.now() });
  }

  function requireValues() {
    var date = els.inputDate.value;
    var amount = Number(els.inputAmount.value);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setStatus(els.confirmStatus, 'Enter a valid transaction date first.', false);
      els.inputDate.focus();
      return false;
    }
    if (!Number.isFinite(amount)) {
      setStatus(els.confirmStatus, 'Enter the total amount first.', false);
      els.inputAmount.focus();
      return false;
    }
    return true;
  }

  async function recordAndFinish(savedTo) {
    var filename = currentFilename();
    var thumbnail = await makeThumbnail(state.blob);
    addRecent({
      filename: filename,
      merchant: (els.inputMerchant.value || '').trim() || undefined,
      date: els.inputDate.value,
      amount: Number(els.inputAmount.value),
      currency: els.inputCurrency.value,
      savedTo: savedTo,
      timestamp: Date.now(),
      thumbnail: thumbnail || undefined
    });
    els.doneFilename.textContent = filename;
    var where =
      savedTo === 'Google Drive' ? 'Saved to the Google Drive folder “Receipts”.' :
      savedTo === 'Shared' ? 'Shared with the filename above. Choose Google Drive if you want it in the Receipts folder.' :
      'Downloaded with the filename above. You can move it into a Google Drive folder named Receipts.';
    els.doneMessage.textContent = where;
    showScreen('done');
  }

  async function onSaveDrive() {
    if (!requireValues()) return;
    if (!ReceiptDrive.isConfigured()) {
      setStatus(els.confirmStatus, 'Add a Google Client ID in config.js to enable Drive uploads.', false);
      return;
    }
    els.saveDriveBtn.disabled = true;
    setStatus(els.confirmStatus, 'Uploading to Google Drive…', true);
    try {
      await ReceiptDrive.saveReceipt(currentFilename(), state.blob);
      await recordAndFinish('Google Drive');
    } catch (err) {
      setStatus(els.confirmStatus, err && err.message ? err.message : 'Upload failed.', false);
    } finally {
      els.saveDriveBtn.disabled = false;
    }
  }

  async function onShare() {
    if (!requireValues()) return;
    var file = namedFile();
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
      setStatus(els.confirmStatus, 'Sharing files is not supported in this browser. Use Download instead.', false);
      return;
    }
    try {
      await navigator.share({
        files: [file],
        title: file.name,
        text: file.name
      });
      await recordAndFinish('Shared');
    } catch (err) {
      if (err && (err.name === 'AbortError' || /cancel/i.test(err.message || ''))) return;
      setStatus(els.confirmStatus, err && err.message ? err.message : 'Share failed.', false);
    }
  }

  async function onDownload() {
    if (!requireValues()) return;
    var file = namedFile();
    var url = URL.createObjectURL(file);
    var a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    await recordAndFinish('Downloaded');
  }

  async function recognize(blob) {
    if (typeof Tesseract === 'undefined' || typeof Tesseract.createWorker !== 'function') {
      throw new Error('The text reader failed to load. Check your connection and try again.');
    }
    setProgress('Reading receipt…', 'Starting…', 5);
    var worker = await Tesseract.createWorker('eng', 1, {
      logger: function (message) {
        if (cancelled) return;
        if (!message) return;
        var pct = typeof message.progress === 'number' ? Math.round(message.progress * 100) : 0;
        var status = message.status ? prettyOcrStatus(message.status) : 'Working…';
        setProgress('Reading receipt…', status + (pct ? ' (' + pct + '%)' : ''), Math.max(8, pct));
      }
    });
    ocrWorker = worker;
    try {
      var result = await worker.recognize(blob);
      return (result && result.data && result.data.text) || '';
    } finally {
      try { await worker.terminate(); } catch (err) { /* ignore */ }
      if (ocrWorker === worker) ocrWorker = null;
    }
  }

  function prettyOcrStatus(status) {
    var map = {
      'loading tesseract core': 'Loading reader',
      'initializing tesseract': 'Starting reader',
      'loading language traineddata': 'Loading English data',
      'initializing api': 'Preparing',
      'recognizing text': 'Reading text'
    };
    return map[status] || status.replace(/_/g, ' ');
  }

  async function cancelOcr() {
    cancelled = true;
    if (ocrWorker && typeof ocrWorker.terminate === 'function') {
      try { await ocrWorker.terminate(); } catch (err) { /* ignore */ }
      ocrWorker = null;
    }
    showScreen('home');
  }

  async function handleFile(file) {
    if (!file) return;
    cancelled = false;
    showScreen('progress');
    setProgress('Preparing photo…', 'Compressing', 2);
    try {
      var blob = await compressImage(file);
      if (cancelled) return;
      state.blob = blob;
      revokePreview();
      state.previewUrl = URL.createObjectURL(blob);
      els.confirmPreview.src = state.previewUrl;
      setProgress('Reading receipt…', 'Looking at the photo', 8);
      var text = await recognize(blob);
      if (cancelled) return;
      var parsed = ReceiptParser.parseReceipt(text);
      fillConfirm(parsed);
      showScreen('confirm');
    } catch (err) {
      if (cancelled) return;
      // Still let the user enter details by hand.
      state.blob = state.blob || file;
      if (!state.previewUrl && state.blob) {
        state.previewUrl = URL.createObjectURL(state.blob);
        els.confirmPreview.src = state.previewUrl;
      }
      fillConfirm({
        date: null,
        amount: null,
        currency: 'USD',
        merchant: null,
        dateConfidence: 'none',
        amountConfidence: 'none',
        currencyConfidence: 'low',
        merchantConfidence: 'none'
      });
      showScreen('confirm');
      setStatus(
        els.confirmStatus,
        (err && err.message ? err.message : 'Could not read the receipt.') + ' You can enter the details yourself.',
        false
      );
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var start = function () {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function (err) {
        console.warn('Service worker registration failed:', err);
      });
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start);
  }

  function bind() {
    els.home = $('home-screen');
    els.progress = $('progress-screen');
    els.confirm = $('confirm-screen');
    els.done = $('done-screen');
    els.cameraInput = $('camera-input');
    els.galleryInput = $('gallery-input');
    els.cameraBtn = $('camera-btn');
    els.galleryBtn = $('gallery-btn');
    els.recentEmpty = $('recent-empty');
    els.recentList = $('recent-list');
    els.progressTitle = $('progress-title');
    els.progressStatus = $('progress-status');
    els.progressFill = $('progress-fill');
    els.progressCancel = $('progress-cancel');
    els.confirmPreview = $('confirm-preview');
    els.inputMerchant = $('input-merchant');
    els.inputDate = $('input-date');
    els.inputAmount = $('input-amount');
    els.inputCurrency = $('input-currency');
    els.fieldMerchant = $('field-merchant');
    els.fieldDate = $('field-date');
    els.fieldAmount = $('field-amount');
    els.fieldCurrency = $('field-currency');
    els.hintMerchant = $('hint-merchant');
    els.hintDate = $('hint-date');
    els.hintAmount = $('hint-amount');
    els.hintCurrency = $('hint-currency');
    els.filenameLive = $('filename-live');
    els.saveDriveBtn = $('save-drive-btn');
    els.driveNote = $('drive-note');
    els.shareBtn = $('share-btn');
    els.downloadBtn = $('download-btn');
    els.confirmStatus = $('confirm-status');
    els.confirmBack = $('confirm-back');
    els.doneMessage = $('done-message');
    els.doneFilename = $('done-filename');
    els.doneHome = $('done-home');

    els.cameraBtn.addEventListener('click', function () { els.cameraInput.click(); });
    els.galleryBtn.addEventListener('click', function () { els.galleryInput.click(); });

    function onPick(event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      handleFile(file);
    }
    els.cameraInput.addEventListener('change', onPick);
    els.galleryInput.addEventListener('change', onPick);

    ['input', 'change'].forEach(function (evt) {
      els.inputMerchant.addEventListener(evt, updateFilenamePreview);
      els.inputDate.addEventListener(evt, updateFilenamePreview);
      els.inputAmount.addEventListener(evt, updateFilenamePreview);
      els.inputCurrency.addEventListener(evt, updateFilenamePreview);
    });

    els.saveDriveBtn.addEventListener('click', function () { onSaveDrive(); });
    els.shareBtn.addEventListener('click', function () { onShare(); });
    els.downloadBtn.addEventListener('click', function () { onDownload(); });
    els.confirmBack.addEventListener('click', function () {
      revokePreview();
      state.blob = null;
      showScreen('home');
    });
    els.doneHome.addEventListener('click', function () {
      revokePreview();
      state.blob = null;
      showScreen('home');
    });
    els.progressCancel.addEventListener('click', function () { cancelOcr(); });

    configureSaveButtons();
    renderRecent();
  }

  registerServiceWorker();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
