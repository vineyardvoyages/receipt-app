/**
 * Google Drive helper: GIS token client, Picker folder setup, Drive REST v3 uploads.
 * Scope: https://www.googleapis.com/auth/drive.file
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ReceiptDrive = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var FOLDER_MIME = 'application/vnd.google-apps.folder';
  var FOLDER_KEY = 'receipts.drive.folder.v1';
  var CONSENT_KEY = 'receipts.drive.consented.v1';
  var TOKEN_KEY = 'receipts.drive.token.v1';
  var LOGIN_HINT = (typeof GOOGLE_LOGIN_HINT === 'string' && GOOGLE_LOGIN_HINT) || 'choeffel@gmail.com';
  var PICKER_TITLE = 'Pick Vineyard Voyages › Receipts (or Vineyard Voyages)';

  var tokenClient = null;
  var accessToken = null;
  var tokenExpiresAt = 0;

  function clientId() {
    return (typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.trim()) || '';
  }

  function apiKey() {
    return (typeof GOOGLE_API_KEY === 'string' && GOOGLE_API_KEY.trim()) || '';
  }

  function appId() {
    return (typeof GOOGLE_APP_ID === 'string' && String(GOOGLE_APP_ID).trim()) || '';
  }

  function isConfigured() {
    return !!(clientId() && apiKey() && appId());
  }

  function hasGis() {
    return !!(root.google && google.accounts && google.accounts.oauth2);
  }

  function hasGapi() {
    return !!(root.gapi && typeof gapi.load === 'function');
  }

  function hasPicker() {
    return !!(root.google && google.picker && google.picker.PickerBuilder);
  }

  function tokenValid() {
    return accessToken && Date.now() < tokenExpiresAt - 15000;
  }

  function readStore(storage, key) {
    try {
      if (!storage) return null;
      var raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeStore(storage, key, value) {
    try {
      if (!storage) return;
      if (value == null) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    } catch (err) { /* ignore quota / private mode */ }
  }

  function loadSessionToken() {
    var data = typeof sessionStorage !== 'undefined' ? readStore(sessionStorage, TOKEN_KEY) : null;
    if (data && data.accessToken && data.expiresAt && data.expiresAt > Date.now() + 15000) {
      accessToken = data.accessToken;
      tokenExpiresAt = data.expiresAt;
      return true;
    }
    return false;
  }

  function persistSessionToken() {
    if (typeof sessionStorage === 'undefined') return;
    if (tokenValid()) {
      writeStore(sessionStorage, TOKEN_KEY, { accessToken: accessToken, expiresAt: tokenExpiresAt });
    } else {
      writeStore(sessionStorage, TOKEN_KEY, null);
    }
  }

  function hasConsented() {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(CONSENT_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function markConsented() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(CONSENT_KEY, '1');
    } catch (err) { /* ignore */ }
  }

  function folderPath(folder) {
    if (!folder) return '';
    var parent = folder.parentName || '';
    var receipts = folder.receiptsFolderName || 'Receipts';
    if (parent && parent.toLowerCase() !== receipts.toLowerCase()) {
      return parent + ' / ' + receipts;
    }
    return receipts;
  }

  function decidePickedFolder(picked) {
    var name = picked && picked.name ? String(picked.name).trim() : '';
    if (name.toLowerCase() === 'receipts') {
      return { kind: 'receipts', id: picked.id, name: picked.name };
    }
    return { kind: 'parent', id: picked.id, name: picked.name };
  }

  function getStoredFolder() {
    if (typeof localStorage === 'undefined') return null;
    var folder = readStore(localStorage, FOLDER_KEY);
    if (!folder || !folder.receiptsFolderId) return null;
    return folder;
  }

  function setStoredFolder(folder) {
    if (typeof localStorage === 'undefined') return folder;
    writeStore(localStorage, FOLDER_KEY, folder);
    return folder;
  }

  function clearStoredFolder() {
    if (typeof localStorage === 'undefined') return;
    writeStore(localStorage, FOLDER_KEY, null);
  }

  function hasFolder() {
    return !!getStoredFolder();
  }

  function ensureTokenClient() {
    if (tokenClient) return tokenClient;
    if (!isConfigured()) {
      throw new Error('Google Drive is not configured in config.js.');
    }
    if (!hasGis()) {
      throw new Error('Google sign-in is still loading. Try again in a moment.');
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
      hint: LOGIN_HINT,
      callback: function () {}
    });
    return tokenClient;
  }

  function requestToken(prompt) {
    ensureTokenClient();
    return new Promise(function (resolve, reject) {
      tokenClient.callback = function (response) {
        if (response && response.error) {
          accessToken = null;
          tokenExpiresAt = 0;
          persistSessionToken();
          var msg = response.error === 'popup_closed_by_user' || response.error === 'access_denied'
            ? 'Google sign-in was cancelled.'
            : 'Google sign-in failed: ' + (response.error_description || response.error);
          reject(new Error(msg));
          return;
        }
        accessToken = response.access_token;
        var seconds = Number(response.expires_in) || 3600;
        tokenExpiresAt = Date.now() + seconds * 1000;
        persistSessionToken();
        markConsented();
        resolve(accessToken);
      };
      try {
        var opts = { hint: LOGIN_HINT };
        if (prompt !== undefined) opts.prompt = prompt;
        tokenClient.requestAccessToken(opts);
      } catch (err) {
        reject(err);
      }
    });
  }

  function getToken(options) {
    options = options || {};
    if (tokenValid() || loadSessionToken()) return Promise.resolve(accessToken);
    var allowInteractive = options.allowInteractive !== false;
    // After the first grant, try a silent refresh first.
    var trySilent = hasConsented() || options.prompt === '';
    var first = trySilent ? requestToken('') : requestToken(undefined);
    return first.catch(function (err) {
      if (!allowInteractive || !trySilent) throw err;
      return requestToken(undefined);
    });
  }

  function clearToken() {
    accessToken = null;
    tokenExpiresAt = 0;
    persistSessionToken();
  }

  function apiFetch(url, options, retried) {
    return getToken().then(function (token) {
      var opts = options ? Object.assign({}, options) : {};
      var headers = Object.assign({}, opts.headers || {}, {
        Authorization: 'Bearer ' + token
      });
      opts.headers = headers;
      return fetch(url, opts).then(function (res) {
        if (res.status === 401 && !retried) {
          clearToken();
          return apiFetch(url, options, true);
        }
        return res;
      });
    });
  }

  function readError(res) {
    return res.text().then(function (text) {
      var detail = text;
      try {
        var json = JSON.parse(text);
        if (json && json.error) {
          detail = json.error.message || json.error.status || text;
        }
      } catch (e) { /* keep raw */ }
      return new Error('Google Drive request failed (' + res.status + '): ' + detail);
    });
  }

  function getFile(id, fields) {
    var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
      '?fields=' + encodeURIComponent(fields || 'id,name,trashed,parents') + '&supportsAllDrives=true';
    return apiFetch(url, { method: 'GET' }).then(function (res) {
      if (!res.ok) return readError(res).then(function (err) { throw err; });
      return res.json();
    });
  }

  function folderAccessible(folderId) {
    return getFile(folderId, 'id,name,trashed').then(function (file) {
      if (!file || file.trashed) throw new Error('The Drive folder has been trashed or is no longer accessible.');
      return file;
    });
  }

  function findChildFolder(parentId, name) {
    var q = "name='" + name.replace(/'/g, "\\'") + "' and '" + parentId +
      "' in parents and mimeType='" + FOLDER_MIME + "' and trashed=false";
    var url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) +
      '&fields=files(id,name)&pageSize=10&spaces=drive';
    return apiFetch(url, { method: 'GET' }).then(function (res) {
      if (!res.ok) return readError(res).then(function (err) { throw err; });
      return res.json();
    }).then(function (data) {
      return data.files && data.files[0] ? data.files[0] : null;
    });
  }

  function createFolder(name, parentId) {
    var body = { name: name, mimeType: FOLDER_MIME };
    if (parentId) body.parents = [parentId];
    return apiFetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) return readError(res).then(function (err) { throw err; });
      return res.json();
    });
  }

  function resolvePickedFolder(picked) {
    var decision = decidePickedFolder(picked);
    if (decision.kind === 'receipts') {
      return getFile(decision.id, 'id,name,parents').then(function (meta) {
        var parentId = meta.parents && meta.parents[0] ? meta.parents[0] : null;
        if (!parentId) {
          return setStoredFolder({
            parentId: null,
            parentName: '',
            receiptsFolderId: meta.id,
            receiptsFolderName: meta.name || 'Receipts'
          });
        }
        return getFile(parentId, 'id,name').then(function (parent) {
          return setStoredFolder({
            parentId: parent.id,
            parentName: parent.name || 'Vineyard Voyages',
            receiptsFolderId: meta.id,
            receiptsFolderName: meta.name || 'Receipts'
          });
        }).catch(function () {
          return setStoredFolder({
            parentId: parentId,
            parentName: 'Vineyard Voyages',
            receiptsFolderId: meta.id,
            receiptsFolderName: meta.name || 'Receipts'
          });
        });
      });
    }
    return findChildFolder(decision.id, 'Receipts').then(function (child) {
      if (child) return child;
      return createFolder('Receipts', decision.id);
    }).then(function (child) {
      return setStoredFolder({
        parentId: decision.id,
        parentName: decision.name || 'Vineyard Voyages',
        receiptsFolderId: child.id,
        receiptsFolderName: child.name || 'Receipts'
      });
    });
  }

  function loadPickerApi() {
    if (hasPicker()) return Promise.resolve();
    if (!hasGapi()) {
      return Promise.reject(new Error('The Google Picker script is still loading. Try again in a moment.'));
    }
    return new Promise(function (resolve, reject) {
      try {
        gapi.load('picker', {
          callback: resolve,
          onerror: function () { reject(new Error('Could not load Google Picker.')); }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function buildFolderPicker(token, callback) {
    if (!hasPicker()) {
      throw new Error('Google Picker is not available.');
    }
    var view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true)
      .setMimeTypes(FOLDER_MIME);
    var builder = new google.picker.PickerBuilder()
      .setTitle(PICKER_TITLE)
      .setAppId(appId())
      .setDeveloperKey(apiKey())
      .setOAuthToken(token)
      .addView(view)
      .setCallback(callback);
    if (typeof location !== 'undefined' && location.origin && builder.setOrigin) {
      builder.setOrigin(location.origin);
    }
    return builder.build();
  }

  function openFolderPicker(token) {
    return new Promise(function (resolve, reject) {
      var picker;
      try {
        picker = buildFolderPicker(token, function (data) {
          if (!data) return;
          var action = data.action;
          if (action === google.picker.Action.PICKED) {
            var doc = data.docs && data.docs[0];
            if (!doc || !doc.id) {
              reject(new Error('No folder was selected.'));
              return;
            }
            resolve({ id: doc.id, name: doc.name || '' });
          } else if (action === google.picker.Action.CANCEL) {
            reject(new Error('Folder selection was cancelled.'));
          }
        });
      } catch (err) {
        reject(err);
        return;
      }
      picker.setVisible(true);
    });
  }

  function connectFolder(options) {
    options = options || {};
    return getToken({ allowInteractive: true }).then(function (token) {
      return loadPickerApi().then(function () { return token; });
    }).then(function (token) {
      return openFolderPicker(token);
    }).then(function (picked) {
      return resolvePickedFolder(picked);
    });
  }

  function uploadJpeg(folderId, filename, blob) {
    var metadata = {
      name: filename,
      parents: [folderId],
      mimeType: 'image/jpeg'
    };
    var boundary = '-------receipts_' + Math.random().toString(36).slice(2);
    var metaPart =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n';
    var fileHead =
      '--' + boundary + '\r\n' +
      'Content-Type: image/jpeg\r\n\r\n';
    var tail = '\r\n--' + boundary + '--';
    var body = new Blob([metaPart, fileHead, blob, tail], {
      type: 'multipart/related; boundary=' + boundary
    });
    var url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name';
    return apiFetch(url, { method: 'POST', body: body }).then(function (res) {
      if (!res.ok) return readError(res).then(function (err) { throw err; });
      return res.json();
    });
  }

  function saveReceipt(filename, blob) {
    var folder = getStoredFolder();
    if (!folder || !folder.receiptsFolderId) {
      return Promise.reject(new Error('Choose a Google Drive folder first.'));
    }
    return folderAccessible(folder.receiptsFolderId).catch(function (err) {
      clearStoredFolder();
      var wrapped = new Error('The Drive folder is no longer accessible. Pick it again.');
      wrapped.cause = err;
      throw wrapped;
    }).then(function () {
      return uploadJpeg(folder.receiptsFolderId, filename, blob);
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
    if (!onlineFn()) {
      return Queue.list().then(function (items) {
        return { uploadedIds: [], failed: [], remaining: (items || []).length };
      });
    }
    if (!hasFolder()) {
      return Queue.list().then(function (items) {
        return { uploadedIds: [], failed: [], remaining: (items || []).length };
      });
    }
    return Queue.flush(function (item) {
      return saveReceipt(item.filename, item.blob);
    }, onlineFn);
  }

  return {
    SCOPE: SCOPE,
    PICKER_TITLE: PICKER_TITLE,
    LOGIN_HINT: LOGIN_HINT,
    isConfigured: isConfigured,
    hasGis: hasGis,
    hasGapi: hasGapi,
    hasPicker: hasPicker,
    hasFolder: hasFolder,
    getStoredFolder: getStoredFolder,
    setStoredFolder: setStoredFolder,
    clearStoredFolder: clearStoredFolder,
    folderPath: folderPath,
    decidePickedFolder: decidePickedFolder,
    buildFolderPicker: buildFolderPicker,
    loadPickerApi: loadPickerApi,
    connectFolder: connectFolder,
    resolvePickedFolder: resolvePickedFolder,
    getToken: getToken,
    clearToken: clearToken,
    saveReceipt: saveReceipt,
    flushQueue: flushQueue,
    clientId: clientId,
    apiKey: apiKey,
    appId: appId
  };
});
