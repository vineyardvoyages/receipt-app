/**
 * Offline upload queue. IndexedDB in the browser; tests can inject a memory store.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ReceiptQueue = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB_NAME = 'receipts-upload-queue';
  var STORE = 'pending';

  function isOfflineError(err, online) {
    if (online === false) return true;
    if (!err) return false;
    var name = err.name || '';
    var msg = String(err.message || err || '');
    if (/^(TypeError|NetworkError|AbortError)$/i.test(name) && /fetch|network|load failed|offline/i.test(msg)) {
      return true;
    }
    if (/failed to fetch|networkerror|network request failed|the internet connection appears to be offline|load failed|offline/i.test(msg)) {
      return true;
    }
    return false;
  }

  function isFolderAccessError(err) {
    if (!err) return false;
    var msg = String(err.message || err || '');
    return /\b(404|403)\b/.test(msg) && /drive|folder|not found|insufficient|inaccessible/i.test(msg) ||
      /folder is no longer accessible|not found|has been trashed/i.test(msg);
  }

  function makeId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function createMemoryStore() {
    var items = {};
    return {
      put: function (item) {
        items[item.id] = item;
        return Promise.resolve(item);
      },
      getAll: function () {
        return Promise.resolve(Object.keys(items).map(function (k) { return items[k]; }));
      },
      delete: function (id) {
        delete items[id];
        return Promise.resolve();
      }
    };
  }

  function createIdbStore() {
    function openDb() {
      return new Promise(function (resolve, reject) {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('IndexedDB is not available.'));
          return;
        }
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }

    function withStore(mode, fn) {
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, mode);
          var store = tx.objectStore(STORE);
          var result = fn(store);
          tx.oncomplete = function () { resolve(result); };
          tx.onerror = function () { reject(tx.error); };
        });
      });
    }

    return {
      put: function (item) {
        return withStore('readwrite', function (store) { store.put(item); return item; });
      },
      getAll: function () {
        return openDb().then(function (db) {
          return new Promise(function (resolve, reject) {
            var tx = db.transaction(STORE, 'readonly');
            var req = tx.objectStore(STORE).getAll();
            req.onsuccess = function () { resolve(req.result || []); };
            req.onerror = function () { reject(req.error); };
          });
        });
      },
      delete: function (id) {
        return withStore('readwrite', function (store) { store.delete(id); });
      }
    };
  }

  function createQueue(store) {
    store = store || (typeof indexedDB !== 'undefined' ? createIdbStore() : createMemoryStore());

    function enqueue(entry) {
      var item = {
        id: entry.id || makeId(),
        filename: entry.filename,
        blob: entry.blob,
        merchant: entry.merchant || '',
        date: entry.date || '',
        amount: entry.amount,
        tip: entry.tip,
        total: entry.total,
        createdAt: entry.createdAt || Date.now(),
        attempts: entry.attempts || 0,
        lastError: entry.lastError || ''
      };
      return store.put(item).then(function () { return item.id; });
    }

    function list() {
      return store.getAll().then(function (items) {
        return (items || []).slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      });
    }

    function remove(id) {
      return store.delete(id);
    }

    function flush(uploadFn, isOnlineFn) {
      var online = typeof isOnlineFn === 'function' ? isOnlineFn() : true;
      return list().then(function (items) {
        var uploadedIds = [];
        var failed = [];
        var chain = Promise.resolve();
        items.forEach(function (item) {
          chain = chain.then(function () {
            if (!online) return;
            return Promise.resolve(uploadFn(item)).then(function () {
              return remove(item.id).then(function () {
                uploadedIds.push(item.id);
              });
            }).catch(function (err) {
              item.attempts = (item.attempts || 0) + 1;
              item.lastError = err && err.message ? err.message : String(err);
              failed.push({ id: item.id, error: item.lastError, offline: isOfflineError(err, online) });
              return store.put(item);
            });
          });
        });
        return chain.then(function () {
          return list().then(function (remaining) {
            return { uploadedIds: uploadedIds, failed: failed, remaining: remaining.length };
          });
        });
      });
    }

    return {
      enqueue: enqueue,
      list: list,
      remove: remove,
      flush: flush,
      store: store
    };
  }

  var defaultQueue = null;
  function getDefault() {
    if (!defaultQueue) defaultQueue = createQueue();
    return defaultQueue;
  }

  return {
    isOfflineError: isOfflineError,
    isFolderAccessError: isFolderAccessError,
    createMemoryStore: createMemoryStore,
    createQueue: createQueue,
    enqueue: function (entry) { return getDefault().enqueue(entry); },
    list: function () { return getDefault().list(); },
    remove: function (id) { return getDefault().remove(id); },
    flush: function (uploadFn, isOnlineFn) { return getDefault().flush(uploadFn, isOnlineFn); }
  };
});
