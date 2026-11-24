/**
 * Uploads receipt JPEGs to the Apps Script web app, which saves them
 * into Vineyard Voyages / Receipts on the owner's Drive.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ReceiptDrive = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function (root) {
  'use strict';

  var FOLDER_PATH = 'Vineyard Voyages / Receipts';
  var PLACEHOLDER_URL = 'PASTE_DEPLOYMENT_URL';

  function uploadUrl() {
    return (typeof UPLOAD_URL === 'string' && UPLOAD_URL.trim()) || '';
  }

  function uploadToken() {
    return (typeof UPLOAD_TOKEN === 'string' && UPLOAD_TOKEN) || '';
  }

  function isConfigured() {
    var url = uploadUrl();
    return !!(url && url !== PLACEHOLDER_URL && uploadToken());
  }

  function folderPath() {
    return FOLDER_PATH;
  }

  function buildUploadBody(filename, data, token, mimeType) {
    return JSON.stringify({
      filename: filename,
      mimeType: mimeType || 'image/jpeg',
      data: data,
      token: token
    });
  }

  function parseUploadResponse(text) {
    var json;
    try {
      json = JSON.parse(String(text || ''));
    } catch (err) {
      throw new Error('The upload server returned an unexpected response.');
    }
    if (!json || json.ok !== true) {
      throw new Error((json && json.error) || 'Upload failed.');
    }
    return json;
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      if (typeof FileReader === 'undefined') {
        reject(new Error('This browser cannot encode the photo for upload.'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || '');
        var comma = s.indexOf(',');
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      reader.onerror = function () { reject(reader.error || new Error('Could not read the photo.')); };
      reader.readAsDataURL(blob);
    });
  }

  function saveReceipt(filename, blob) {
    if (!isConfigured()) {
      return Promise.reject(new Error('Upload is not configured yet.'));
    }
    return blobToBase64(blob).then(function (data) {
      return fetch(uploadUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: buildUploadBody(filename, data, uploadToken(), 'image/jpeg')
      });
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      return parseUploadResponse(text);
    });
  }

  function flushQueue(queueApi, isOnlineFn) {
    var Queue = queueApi || root.ReceiptQueue;
    if (!Queue || typeof Queue.flush !== 'function') {
      return Promise.resolve({ uploadedIds: [], failed: [], remaining: 0 });
    }
    var onlineFn = isOnlineFn || function () {
      return typeof navigator === 'undefined' || navigator.onLine !== false;
    };
    if (!isConfigured() || !onlineFn()) {
      return Queue.list().then(function (items) {
        return { uploadedIds: [], failed: [], remaining: (items || []).length };
      });
    }
    return Queue.flush(function (item) {
      return saveReceipt(item.filename, item.blob);
    }, onlineFn);
  }

  return {
    FOLDER_PATH: FOLDER_PATH,
    isConfigured: isConfigured,
    folderPath: folderPath,
    buildUploadBody: buildUploadBody,
    parseUploadResponse: parseUploadResponse,
    saveReceipt: saveReceipt,
    flushQueue: flushQueue
  };
});
