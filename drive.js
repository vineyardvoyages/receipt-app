/**
 * Google Drive helper (Drive REST v3 + Google Identity Services token client).
 * Scope: https://www.googleapis.com/auth/drive.file
 * Only files created by this app are visible with that scope.
 */
(function (root) {
  'use strict';

  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var FOLDER_NAME = 'Receipts';
  var FOLDER_MIME = 'application/vnd.google-apps.folder';
  var tokenClient = null;
  var accessToken = null;
  var tokenExpiresAt = 0;

  function clientId() {
    return (typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.trim()) || '';
  }

  function isConfigured() {
    return !!clientId();
  }

  function hasGis() {
    return !!(root.google && google.accounts && google.accounts.oauth2);
  }

  function tokenValid() {
    return accessToken && Date.now() < tokenExpiresAt - 15000;
  }

  function ensureTokenClient() {
    if (tokenClient) return tokenClient;
    if (!isConfigured()) {
      throw new Error('Google Client ID is not set in config.js.');
    }
    if (!hasGis()) {
      throw new Error('Google sign-in is still loading. Try again in a moment.');
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
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
          var msg = response.error === 'popup_closed_by_user' || response.error === 'access_denied'
            ? 'Google sign-in was cancelled.'
            : 'Google sign-in failed: ' + (response.error_description || response.error);
          reject(new Error(msg));
          return;
        }
        accessToken = response.access_token;
        var seconds = Number(response.expires_in) || 3600;
        tokenExpiresAt = Date.now() + seconds * 1000;
        resolve(accessToken);
      };
      try {
        var opts = {};
        if (prompt !== undefined) opts.prompt = prompt;
        tokenClient.requestAccessToken(opts);
      } catch (err) {
        reject(err);
      }
    });
  }

  function getToken() {
    if (tokenValid()) return Promise.resolve(accessToken);
    // After the first grant, ask without forcing the consent screen.
    return requestToken(accessToken ? '' : undefined);
  }

  function clearToken() {
    accessToken = null;
    tokenExpiresAt = 0;
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

  function findOrCreateReceiptsFolder() {
    var q = "name='" + FOLDER_NAME + "' and mimeType='" + FOLDER_MIME + "' and trashed=false";
    var url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) +
      '&fields=files(id,name)&pageSize=10&spaces=drive';
    return apiFetch(url, { method: 'GET' }).then(function (res) {
      if (!res.ok) return readError(res).then(function (err) { throw err; });
      return res.json();
    }).then(function (data) {
      if (data.files && data.files.length) return data.files[0].id;
      return apiFetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME })
      }).then(function (res) {
        if (!res.ok) return readError(res).then(function (err) { throw err; });
        return res.json();
      }).then(function (folder) {
        return folder.id;
      });
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
    return findOrCreateReceiptsFolder().then(function (folderId) {
      return uploadJpeg(folderId, filename, blob);
    });
  }

  root.ReceiptDrive = {
    FOLDER_NAME: FOLDER_NAME,
    isConfigured: isConfigured,
    hasGis: hasGis,
    saveReceipt: saveReceipt,
    clearToken: clearToken
  };
})(typeof self !== 'undefined' ? self : this);
