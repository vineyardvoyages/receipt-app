(function () {
  'use strict';

  var APP_VERSION = 'v6 · 2026-11-23';
  var RECENT_KEY = 'receipts.recent.v1';
  var RECENT_LIMIT = 20;
  var SAVE_MAX_EDGE = 1600;
  var OCR_MAX_EDGE = 2200;
  var ORIENT_MAX_EDGE = 1000;
  var JPEG_QUALITY = 0.7;
  var RECEIPT_KEYWORDS =
    /\b(TOTAL|SUBTOTAL|AMOUNT|CHARGED|DATE|TIME|CARD|CREDIT|PURCHASE|TAX|TIP|AUTH|APPROVED|RECEIPT|STORE|THANKS|VISITING|INVOICE|BALANCE|SIGNATURE|MERCHANT|PAYMENT|ORDER|SALE)\b/gi;

  var cancelled = false;
  var saving = false;
  var toastTimer = null;
  var pendingQueueId = null;
  var ocrWorker = null;
  var ocrBusy = false;

  var state = {
    blob: null,
    previewUrl: null,
    parsed: null,
    colorCanvas: null
  };

  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function show(el) {
    if (el) el.classList.remove('hidden');
  }

  function hide(el) {
    if (el) el.classList.add('hidden');
  }

  function setStatus(node, message, ok) {
    if (!message) {
      hide(node);
      node.textContent = '';
      return;
    }
    node.textContent = message;
    node.classList.remove('err-box');
    node.classList.toggle('ok', !!ok);
    show(node);
  }

  function showToast(message, kind, linkUrl, ms) {
    if (!els.toast) return;
    if (toastTimer) clearTimeout(toastTimer);
    els.toastText.textContent = message;
    els.toast.classList.remove('ok', 'err');
    els.toast.classList.add(kind === 'ok' ? 'ok' : 'err');
    if (linkUrl) {
      els.toastLink.href = linkUrl;
      show(els.toastLink);
    } else {
      els.toastLink.removeAttribute('href');
      hide(els.toastLink);
    }
    show(els.toast);
    toastTimer = setTimeout(function () { hide(els.toast); }, ms || 7000);
  }

  function setSaving(on) {
    saving = on;
    els.saveDriveBtn.disabled = on;
    if (els.retryBtn) els.retryBtn.disabled = on;
    if (on) {
      els.saveDriveBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Saving…';
    } else {
      els.saveDriveBtn.textContent = 'Save to Drive';
    }
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
      if (item.savedTo === 'Saved to Drive') parts.push('✓ Saved');
      else if (item.savedTo === 'Waiting to upload') parts.push('⏳ Waiting to upload');
      else if (item.savedTo) parts.push(item.savedTo);
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

  function markRecentUploaded(queueId) {
    if (!queueId) return;
    var list = loadRecent();
    var changed = false;
    list.forEach(function (item) {
      if (item.queueId === queueId) {
        item.savedTo = 'Saved to Drive';
        delete item.queueId;
        changed = true;
      }
    });
    if (changed) {
      saveRecent(list);
      renderRecent();
    }
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

  function sourceSize(source) {
    return { width: source.width, height: source.height };
  }

  function drawToCanvas(source, maxEdge, fill) {
    var size = sourceSize(source);
    var longEdge = Math.max(size.width, size.height) || 1;
    var scale = maxEdge && longEdge > maxEdge ? maxEdge / longEdge : 1;
    var w = Math.max(1, Math.round(size.width * scale));
    var h = Math.max(1, Math.round(size.height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(source, 0, 0, w, h);
    return canvas;
  }

  function cropCanvas(source, box) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, box.w);
    canvas.height = Math.max(1, box.h);
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    return canvas;
  }

  function rotateCanvas(source, degrees) {
    var deg = ((degrees % 360) + 360) % 360;
    if (deg === 0) return drawToCanvas(source, 0);
    var w = source.width;
    var h = source.height;
    var canvas = document.createElement('canvas');
    if (deg % 180 === 0) {
      canvas.width = w;
      canvas.height = h;
    } else {
      canvas.width = h;
      canvas.height = w;
    }
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(deg * Math.PI / 180);
    ctx.drawImage(source, -w / 2, -h / 2);
    return canvas;
  }

  function toGrayscaleContrast(source) {
    var canvas = drawToCanvas(source, 0);
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var data = img.data;
    var min = 255;
    var max = 0;
    var i;
    for (i = 0; i < data.length; i += 4) {
      var g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = data[i + 1] = data[i + 2] = g;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    var span = max - min || 1;
    // Contrast stretch, then a slight push toward black/white for text.
    for (i = 0; i < data.length; i += 4) {
      var v = (data[i] - min) / span;
      v = Math.max(0, Math.min(1, (v - 0.08) / 0.84));
      var out = Math.round(v * 255);
      data[i] = data[i + 1] = data[i + 2] = out;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function otsuThreshold(hist, total) {
    var sum = 0;
    var t;
    for (t = 0; t < 256; t++) sum += t * hist[t];
    var sumB = 0;
    var wB = 0;
    var max = 0;
    var threshold = 180;
    for (t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      var mB = sumB / wB;
      var mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > max) {
        max = between;
        threshold = t;
      }
    }
    return threshold;
  }

  function findPaperBox(source) {
    var probe = drawToCanvas(source, 480);
    var ctx = probe.getContext('2d', { willReadFrequently: true });
    var img = ctx.getImageData(0, 0, probe.width, probe.height);
    var data = img.data;
    var hist = new Array(256);
    var i;
    for (i = 0; i < 256; i++) hist[i] = 0;
    var gray = new Uint8Array(probe.width * probe.height);
    for (i = 0; i < gray.length; i++) {
      var o = i * 4;
      var g = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
      gray[i] = g;
      hist[g]++;
    }
    var threshold = Math.max(140, otsuThreshold(hist, gray.length));
    var minX = probe.width;
    var minY = probe.height;
    var maxX = -1;
    var maxY = -1;
    var paper = 0;
    for (i = 0; i < gray.length; i++) {
      if (gray[i] < threshold) continue;
      paper++;
      var x = i % probe.width;
      var y = (i / probe.width) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    var ratio = paper / gray.length;
    if (ratio < 0.08 || ratio > 0.96 || maxX < minX) return null;
    var padX = Math.round((maxX - minX + 1) * 0.04);
    var padY = Math.round((maxY - minY + 1) * 0.04);
    minX = Math.max(0, minX - padX);
    minY = Math.max(0, minY - padY);
    maxX = Math.min(probe.width - 1, maxX + padX);
    maxY = Math.min(probe.height - 1, maxY + padY);
    var sx = source.width / probe.width;
    var sy = source.height / probe.height;
    return {
      x: Math.round(minX * sx),
      y: Math.round(minY * sy),
      w: Math.round((maxX - minX + 1) * sx),
      h: Math.round((maxY - minY + 1) * sy)
    };
  }

  function horizontalTextScore(canvas) {
    var probe = drawToCanvas(canvas, 320);
    var ctx = probe.getContext('2d', { willReadFrequently: true });
    var img = ctx.getImageData(0, 0, probe.width, probe.height);
    var data = img.data;
    var w = probe.width;
    var h = probe.height;
    var rowInk = new Float64Array(h);
    var colInk = new Float64Array(w);
    var y;
    var x;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var g = data[(y * w + x) * 4];
        if (g < 140) {
          rowInk[y]++;
          colInk[x]++;
        }
      }
    }
    function variance(arr, len, denom) {
      var mean = 0;
      var i;
      for (i = 0; i < len; i++) mean += arr[i] / denom;
      mean /= len;
      var v = 0;
      for (i = 0; i < len; i++) {
        var d = arr[i] / denom - mean;
        v += d * d;
      }
      return v / len;
    }
    function bandCount(arr, len, denom) {
      var count = 0;
      var inBand = false;
      var i;
      for (i = 0; i < len; i++) {
        var frac = arr[i] / denom;
        var isText = frac > 0.02 && frac < 0.55;
        if (isText && !inBand) {
          count++;
          inBand = true;
        } else if (!isText) {
          inBand = false;
        }
      }
      return count;
    }
    var rowVar = variance(rowInk, h, w);
    var colVar = variance(colInk, w, h);
    var rows = bandCount(rowInk, h, w);
    // Upright receipt text makes stripy horizontal lines: high row variance, many bands.
    return rowVar * 8 + rows * 0.35 - colVar * 2;
  }

  function keywordScore(text) {
    if (!text) return 0;
    var matches = String(text).match(RECEIPT_KEYWORDS);
    var letters = (String(text).match(/[A-Za-z]/g) || []).length;
    return (matches ? matches.length : 0) * 8 + Math.min(letters, 500) * 0.04;
  }

  async function detectOrientation(colorCanvas, worker) {
    var base = toGrayscaleContrast(drawToCanvas(colorCanvas, ORIENT_MAX_EDGE));
    var degrees = [0, 90, 180, 270];
    var scored = degrees.map(function (deg) {
      var rotated = deg === 0 ? base : rotateCanvas(base, deg);
      return { deg: deg, structure: horizontalTextScore(rotated), canvas: rotated };
    });
    scored.sort(function (a, b) { return b.structure - a.structure; });

    // Projection finds the reading axis but not which way is up (0 vs 180).
    var axis = [scored[0], scored[1] && Math.abs(scored[0].deg - scored[1].deg) === 180 ? scored[1] : null];
    if (!axis[1]) {
      var flip = (scored[0].deg + 180) % 360;
      var found = scored.filter(function (s) { return s.deg === flip; })[0];
      axis[1] = found || scored[1];
    }

    var best = axis[0];
    var bestScore = -1;
    var i;
    for (i = 0; i < axis.length; i++) {
      if (!axis[i] || cancelled) continue;
      if (els.progressStatus) {
        setProgress('Checking orientation…', 'Trying rotation ' + axis[i].deg + '°', 20 + i * 15);
      }
      try {
        var result = await worker.recognize(axis[i].canvas);
        var text = (result && result.data && result.data.text) || '';
        var conf = result && result.data && typeof result.data.confidence === 'number' ? result.data.confidence : 0;
        var score = axis[i].structure + keywordScore(text) + conf * 0.4;
        if (score > bestScore) {
          bestScore = score;
          best = axis[i];
        }
      } catch (err) {
        // Keep the structural pick if a probe OCR fails.
      }
    }
    return best ? best.deg : 0;
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
    if (!els.progressTitle) return;
    els.progressTitle.textContent = title || 'Reading receipt…';
    els.progressStatus.textContent = status || '';
    var value = Math.max(0, Math.min(100, Number(percent) || 0));
    els.progressFill.style.width = value + '%';
  }

  function tipValue() {
    if (!els.inputTip || els.inputTip.value === '') return 0;
    var n = Number(els.inputTip.value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function chargedTotal() {
    var amount = els.inputAmount.value === '' ? NaN : Number(els.inputAmount.value);
    return ReceiptParser.moneySum(amount, tipValue());
  }

  function currentFilename() {
    var date = els.inputDate.value || '';
    var merchant = els.inputMerchant.value || '';
    return ReceiptParser.buildFilename(date, chargedTotal(), merchant);
  }

  function updateFilenamePreview() {
    els.filenameLive.textContent = currentFilename();
    var tip = tipValue();
    var total = chargedTotal();
    if (tip > 0 && total != null) {
      els.totalCharged.textContent = '$' + total.toFixed(2);
      show(els.fieldTotalCharged);
    } else {
      els.totalCharged.textContent = '';
      hide(els.fieldTotalCharged);
    }
  }

  function markUncertain(fieldEl, hintEl, uncertain, message) {
    fieldEl.classList.toggle('uncertain', !!uncertain);
    hintEl.textContent = uncertain ? (message || 'Please check') : '';
  }

  function fillConfirm(parsed) {
    pendingQueueId = null;
    if (els.retryBtn) hide(els.retryBtn);
    state.parsed = parsed;
    els.inputMerchant.value = parsed.merchant || '';
    els.inputDate.value = parsed.date || '';
    els.inputAmount.value = parsed.amount == null ? '' : Number(parsed.amount).toFixed(2);
    if (els.inputTip) els.inputTip.value = '';

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
    updateFilenamePreview();
    setStatus(els.confirmStatus, '', false);
    configureSaveButtons();
  }

  function folderLabel() {
    return (ReceiptDrive && ReceiptDrive.folderPath && ReceiptDrive.folderPath()) || 'Vineyard Voyages / Receipts';
  }

  function renderDriveStatus() {
    if (!els.driveStatusText) return;
    els.driveStatusText.textContent = 'Saving to: ' + folderLabel();
    var configured = ReceiptDrive.isConfigured();
    if (configured) {
      hide(els.driveNote);
      show(els.saveDriveBtn);
    } else {
      show(els.driveNote);
      show(els.saveDriveBtn);
    }
  }

  function configureSaveButtons() {
    renderDriveStatus();
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
      setStatus(els.confirmStatus, 'Enter the amount on the receipt first.', false);
      els.inputAmount.focus();
      return false;
    }
    var tip = els.inputTip && els.inputTip.value !== '' ? Number(els.inputTip.value) : 0;
    if (els.inputTip && els.inputTip.value !== '' && (!Number.isFinite(tip) || tip < 0)) {
      setStatus(els.confirmStatus, 'Enter a valid tip, or leave it blank.', false);
      els.inputTip.focus();
      return false;
    }
    return true;
  }

  async function recordAndFinish(savedTo, extra) {
    extra = extra || {};
    var filename = currentFilename();
    var thumbnail = await makeThumbnail(state.blob);
    var tip = tipValue();
    addRecent({
      filename: filename,
      merchant: (els.inputMerchant.value || '').trim() || undefined,
      date: els.inputDate.value,
      amount: Number(els.inputAmount.value),
      tip: tip || undefined,
      total: chargedTotal(),
      currency: 'USD',
      savedTo: savedTo,
      folderPath: extra.folderPath || folderLabel(),
      queueId: extra.queueId,
      timestamp: Date.now(),
      thumbnail: thumbnail || undefined
    });
    els.doneFilename.textContent = filename;
    var path = extra.folderPath || folderLabel();
    var where =
      savedTo === 'Saved to Drive' ? 'Saved to ' + path :
      savedTo === 'Waiting to upload' ? 'Saved on this device and waiting to upload to ' + path + ' when you are back online.' :
      'Saved on this device.';
    els.doneMessage.textContent = where;
    if (els.doneLinkWrap) {
      if (savedTo === 'Saved to Drive' && extra.fileUrl) {
        els.doneLink.href = extra.fileUrl;
        els.doneLink.textContent = 'Open in Google Drive';
        show(els.doneLinkWrap);
      } else {
        els.doneLink.removeAttribute('href');
        hide(els.doneLinkWrap);
      }
    }
    showScreen('done');
  }

  function uploadFailedMessage(err) {
    var reason = err && err.message ? err.message : 'Unknown error';
    if (/failed to fetch|networkerror|load failed/i.test(reason)) reason = 'No connection to Google Drive';
    return reason;
  }

  async function onSaveDrive() {
    if (saving) return;
    if (!requireValues()) return;
    if (!ReceiptDrive.isConfigured()) {
      setStatus(els.confirmStatus, 'Upload is not configured yet.', false);
      return;
    }
    setSaving(true);
    hide(els.retryBtn);
    setStatus(els.confirmStatus, '', false);
    var filename = currentFilename();
    try {
      var result = await ReceiptDrive.saveReceipt(filename, state.blob);
      showToast('Saved to Drive ✓ ' + (result.name || filename), 'ok', result.url, 8000);
      await recordAndFinish('Saved to Drive', { fileUrl: result && result.url });
    } catch (err) {
      var reason = uploadFailedMessage(err);
      var Queue = window.ReceiptQueue;
      try {
        if (!Queue) throw new Error('queue unavailable');
        pendingQueueId = await Queue.enqueue({
          filename: filename,
          blob: state.blob,
          merchant: (els.inputMerchant.value || '').trim(),
          date: els.inputDate.value,
          amount: Number(els.inputAmount.value),
          tip: tipValue() || undefined,
          total: chargedTotal()
        });
        await addQueuedRecent(filename, pendingQueueId);
        setStatus(els.confirmStatus, 'Upload failed: ' + reason + '. Saved on this phone and queued; it will retry automatically, or tap Retry.', false);
        els.confirmStatus.classList.add('err-box');
        showToast('Upload failed: ' + reason + ' — queued for retry', 'err', null, 8000);
        show(els.retryBtn);
      } catch (queueErr) {
        setStatus(els.confirmStatus, 'Upload failed: ' + reason + '. Tap Save to Drive to try again.', false);
        els.confirmStatus.classList.add('err-box');
        showToast('Upload failed: ' + reason, 'err', null, 8000);
      }
      els.confirmStatus.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      setSaving(false);
    }
  }

  async function addQueuedRecent(filename, queueId) {
    var thumbnail = await makeThumbnail(state.blob);
    addRecent({
      filename: filename,
      merchant: (els.inputMerchant.value || '').trim() || undefined,
      date: els.inputDate.value,
      amount: Number(els.inputAmount.value),
      tip: tipValue() || undefined,
      total: chargedTotal(),
      currency: 'USD',
      savedTo: 'Waiting to upload',
      folderPath: folderLabel(),
      queueId: queueId,
      timestamp: Date.now(),
      thumbnail: thumbnail || undefined
    });
  }

  async function onRetry() {
    if (saving || !pendingQueueId) return;
    setSaving(true);
    var id = pendingQueueId;
    try {
      var result = await ReceiptDrive.flushQueue();
      var okIds = (result && result.uploadedIds) || [];
      okIds.forEach(markRecentUploaded);
      if (okIds.indexOf(id) !== -1) {
        pendingQueueId = null;
        hide(els.retryBtn);
        var filename = currentFilename();
        showToast('Saved to Drive ✓ ' + filename, 'ok', null, 8000);
        els.doneFilename.textContent = filename;
        els.doneMessage.textContent = 'Saved to ' + folderLabel();
        hide(els.doneLinkWrap);
        showScreen('done');
      } else {
        var f = result && result.failed && result.failed[0];
        var reason = uploadFailedMessage(f && f.error ? { message: String(f.error) } : null);
        setStatus(els.confirmStatus, 'Still not uploaded: ' + reason + '. It stays queued and will retry automatically.', false);
        els.confirmStatus.classList.add('err-box');
        showToast('Retry failed: ' + reason, 'err', null, 7000);
      }
    } catch (err) {
      showToast('Retry failed: ' + uploadFailedMessage(err), 'err', null, 7000);
    } finally {
      setSaving(false);
    }
  }

  async function flushUploads() {
    if (!ReceiptDrive.isConfigured || !ReceiptDrive.isConfigured()) return;
    try {
      var result = await ReceiptDrive.flushQueue();
      if (result && result.uploadedIds && result.uploadedIds.length) {
        result.uploadedIds.forEach(markRecentUploaded);
        showToast('Uploaded ' + result.uploadedIds.length + ' queued receipt(s) ✓', 'ok', null, 6000);
      }
    } catch (err) {
      /* retry next time the app opens or comes online */
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
    return map[status] || String(status || '').replace(/_/g, ' ');
  }

  async function getWorker() {
    if (typeof Tesseract === 'undefined' || typeof Tesseract.createWorker !== 'function') {
      throw new Error('The text reader failed to load. Check your connection and try again.');
    }
    if (ocrWorker) return ocrWorker;
    ocrWorker = await Tesseract.createWorker('eng', 1, {
      logger: function (message) {
        if (cancelled || !message) return;
        if (ocrBusy) return;
        var pct = typeof message.progress === 'number' ? Math.round(message.progress * 100) : 0;
        var status = message.status ? prettyOcrStatus(message.status) : 'Working…';
        setProgress('Reading receipt…', status + (pct ? ' (' + pct + '%)' : ''), Math.max(55, 55 + pct * 0.4));
      }
    });
    try {
      await ocrWorker.setParameters({ tessedit_pageseg_mode: '6' });
    } catch (err) { /* default PSM is fine */ }
    return ocrWorker;
  }

  async function cancelOcr() {
    cancelled = true;
    if (ocrWorker && typeof ocrWorker.terminate === 'function') {
      try { await ocrWorker.terminate(); } catch (err) { /* ignore */ }
      ocrWorker = null;
    }
    showScreen('home');
  }

  async function prepareImage(file) {
    setProgress('Preparing photo…', 'Loading', 4);
    var bitmap = await blobToBitmap(file);
    var working = drawToCanvas(bitmap, 3200, '#ffffff');
    if (typeof bitmap.close === 'function') bitmap.close();
    if (cancelled) return null;

    setProgress('Preparing photo…', 'Finding the receipt', 10);
    var paper = findPaperBox(working);
    var cropped = paper ? cropCanvas(working, paper) : working;

    setProgress('Checking orientation…', 'Looking at the layout', 16);
    var worker = await getWorker();
    if (cancelled) return null;
    ocrBusy = true;
    var rotation;
    try {
      rotation = await detectOrientation(cropped, worker);
    } finally {
      ocrBusy = false;
    }
    if (cancelled) return null;

    var upright = rotateCanvas(cropped, rotation);
    state.colorCanvas = drawToCanvas(upright, 2600, '#ffffff');
    try { window.__receiptRotation = rotation; } catch (debugErr) { /* ignore */ }
    return state.colorCanvas;
  }

  async function refreshSavePreview(colorCanvas) {
    var saveCanvas = drawToCanvas(colorCanvas, SAVE_MAX_EDGE, '#ffffff');
    var blob = await canvasToJpegBlob(saveCanvas, JPEG_QUALITY);
    state.blob = blob;
    revokePreview();
    state.previewUrl = URL.createObjectURL(blob);
    els.confirmPreview.src = state.previewUrl;
    return blob;
  }

  async function ocrPreparedCanvas(colorCanvas) {
    var ocrSource = toGrayscaleContrast(drawToCanvas(colorCanvas, OCR_MAX_EDGE));
    ocrBusy = false;
    setProgress('Reading receipt…', 'Reading text', 58);
    var worker = await getWorker();
    var result = await worker.recognize(ocrSource);
    var text = (result && result.data && result.data.text) || '';
    try {
      window.__receiptDebug = {
        text: text,
        confidence: result && result.data && result.data.confidence,
        parsed: ReceiptParser.parseReceipt(text)
      };
    } catch (debugErr) { /* ignore */ }
    return text;
  }

  async function handleFile(file) {
    if (!file) return;
    cancelled = false;
    showScreen('progress');
    setProgress('Preparing photo…', 'Starting', 2);
    try {
      var color = await prepareImage(file);
      if (cancelled || !color) return;
      await refreshSavePreview(color);
      if (cancelled) return;
      var text = await ocrPreparedCanvas(color);
      if (cancelled) return;
      fillConfirm(ReceiptParser.parseReceipt(text));
      showScreen('confirm');
    } catch (err) {
      if (cancelled) return;
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
        currencyConfidence: 'high',
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

  async function onRotate() {
    if (!state.colorCanvas || cancelled) return;
    cancelled = false;
    showScreen('progress');
    setProgress('Rotating…', 'Turning the photo', 12);
    try {
      state.colorCanvas = rotateCanvas(state.colorCanvas, 90);
      await refreshSavePreview(state.colorCanvas);
      if (cancelled) return;
      var text = await ocrPreparedCanvas(state.colorCanvas);
      if (cancelled) return;
      fillConfirm(ReceiptParser.parseReceipt(text));
      showScreen('confirm');
    } catch (err) {
      if (cancelled) return;
      showScreen('confirm');
      setStatus(els.confirmStatus, err && err.message ? err.message : 'Could not rotate and re-read the receipt.', false);
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var hadController = !!navigator.serviceWorker.controller;
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloading || saving) return;
      reloading = true;
      window.location.reload();
    });
    var start = function () {
      navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(function (reg) {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        reg.addEventListener('updatefound', function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function () {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) sw.postMessage({ type: 'SKIP_WAITING' });
          });
        });
        reg.update().catch(function () {});
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') reg.update().catch(function () {});
        });
      }).catch(function (err) {
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
    els.rotateBtn = $('rotate-btn');
    els.inputMerchant = $('input-merchant');
    els.inputDate = $('input-date');
    els.inputAmount = $('input-amount');
    els.inputTip = $('input-tip');
    els.fieldMerchant = $('field-merchant');
    els.fieldDate = $('field-date');
    els.fieldAmount = $('field-amount');
    els.fieldTip = $('field-tip');
    els.fieldTotalCharged = $('field-total-charged');
    els.totalCharged = $('total-charged');
    els.hintMerchant = $('hint-merchant');
    els.hintDate = $('hint-date');
    els.hintAmount = $('hint-amount');
    els.hintTip = $('hint-tip');
    els.filenameLive = $('filename-live');
    els.driveStatusText = $('drive-status-text');
    els.saveDriveBtn = $('save-drive-btn');
    els.driveNote = $('drive-note');
    els.retryBtn = $('retry-btn');
    els.toast = $('toast');
    els.toastText = $('toast-text');
    els.toastLink = $('toast-link');
    els.appVersion = $('app-version');
    els.confirmStatus = $('confirm-status');
    els.confirmBack = $('confirm-back');
    els.doneMessage = $('done-message');
    els.doneLinkWrap = $('done-link-wrap');
    els.doneLink = $('done-link');
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
      els.inputTip.addEventListener(evt, updateFilenamePreview);
    });

    els.rotateBtn.addEventListener('click', function () { onRotate(); });
    els.saveDriveBtn.addEventListener('click', function () { onSaveDrive(); });
    els.retryBtn.addEventListener('click', function () { onRetry(); });
    if (els.appVersion) els.appVersion.textContent = 'Receipts ' + APP_VERSION;
    els.confirmBack.addEventListener('click', function () {
      revokePreview();
      state.blob = null;
      state.colorCanvas = null;
      showScreen('home');
    });
    els.doneHome.addEventListener('click', function () {
      revokePreview();
      state.blob = null;
      state.colorCanvas = null;
      showScreen('home');
    });
    els.progressCancel.addEventListener('click', function () { cancelOcr(); });

    configureSaveButtons();
    renderRecent();
    flushUploads();
    window.addEventListener('online', function () { flushUploads(); });
  }

  registerServiceWorker();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
