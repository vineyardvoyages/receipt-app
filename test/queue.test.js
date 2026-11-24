'use strict';

const assert = require('assert');
const path = require('path');
const queue = require(path.join(__dirname, '..', 'queue.js'));
const drive = require(path.join(__dirname, '..', 'drive.js'));

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected, msg) {
  try {
    assert.deepStrictEqual(actual, expected, msg);
    passed += 1;
  } catch (err) {
    failed += 1;
    failures.push(msg + '\n    expected: ' + JSON.stringify(expected) + '\n    actual:   ' + JSON.stringify(actual));
  }
}

function ok(condition, msg) {
  if (condition) passed += 1;
  else {
    failed += 1;
    failures.push(msg);
  }
}

// Offline detection
ok(queue.isOfflineError(new Error('Failed to fetch'), true), 'Failed to fetch is offline');
ok(queue.isOfflineError(new TypeError('Failed to fetch'), true), 'TypeError Failed to fetch is offline');
ok(queue.isOfflineError(new Error('anything'), false), 'navigator.offline counts as offline');
ok(!queue.isOfflineError(new Error('Google Drive request failed (403): Forbidden'), true), '403 is not offline');
ok(!queue.isOfflineError(new Error('Google Drive request failed (401): Unauthorized'), true), '401 is not offline');
ok(queue.isFolderAccessError(new Error('The Drive folder is no longer accessible. Pick it again.')), 'inaccessible folder is detected');

eq(drive.folderPath(), 'Vineyard Voyages / Receipts', 'Folder path is Vineyard Voyages / Receipts');
eq(drive.FOLDER_PATH, 'Vineyard Voyages / Receipts', 'FOLDER_PATH constant');

const prevUrl = globalThis.UPLOAD_URL;
const prevToken = globalThis.UPLOAD_TOKEN;
globalThis.UPLOAD_URL = 'PASTE_DEPLOYMENT_URL';
globalThis.UPLOAD_TOKEN = 'N33AecjgX-NPQnwxLczfbQgIFJJEQypF';
ok(!drive.isConfigured(), 'placeholder URL is not configured');
globalThis.UPLOAD_URL = '';
ok(!drive.isConfigured(), 'empty URL is not configured');
globalThis.UPLOAD_URL = 'https://script.google.com/macros/s/EXAMPLE/exec';
globalThis.UPLOAD_TOKEN = '';
ok(!drive.isConfigured(), 'missing token is not configured');
globalThis.UPLOAD_TOKEN = 'N33AecjgX-NPQnwxLczfbQgIFJJEQypF';
ok(drive.isConfigured(), 'real URL and token are configured');

const payload = JSON.parse(drive.buildUploadBody('Fabbioli Cellars 2026-11-21 $225.00.jpg', 'QUJD', 'tok'));
eq(payload.filename, 'Fabbioli Cellars 2026-11-21 $225.00.jpg', 'upload body includes filename');
eq(payload.mimeType, 'image/jpeg', 'upload body defaults to image/jpeg');
eq(payload.data, 'QUJD', 'upload body includes base64 data');
eq(payload.token, 'tok', 'upload body includes token');

const okRes = drive.parseUploadResponse('{"ok":true,"id":"file1","name":"a.jpg","url":"https://drive.google.com/file/d/file1"}');
eq(okRes.id, 'file1', 'successful upload returns file id');
eq(okRes.url, 'https://drive.google.com/file/d/file1', 'successful upload returns file url');

let threw = '';
try { drive.parseUploadResponse('{"ok":false,"error":"Unauthorized."}'); } catch (err) { threw = err.message; }
eq(threw, 'Unauthorized.', 'error JSON becomes an Error with the server message');
threw = '';
try { drive.parseUploadResponse('<html>oops</html>'); } catch (err) { threw = err.message; }
ok(/unexpected response/i.test(threw), 'non-JSON response is rejected');

if (prevUrl === undefined) delete globalThis.UPLOAD_URL; else globalThis.UPLOAD_URL = prevUrl;
if (prevToken === undefined) delete globalThis.UPLOAD_TOKEN; else globalThis.UPLOAD_TOKEN = prevToken;

// Queue enqueue / list / remove / flush
async function runQueueTests() {
  const mem = queue.createQueue(queue.createMemoryStore());
  const id = await mem.enqueue({
    filename: 'Fabbioli Cellars 2026-11-21 $270.00.jpg',
    blob: { fake: true },
    amount: 225,
    tip: 45
  });
  ok(!!id, 'enqueue returns an id');
  let items = await mem.list();
  eq(items.length, 1, 'queue has one item');
  eq(items[0].filename, 'Fabbioli Cellars 2026-11-21 $270.00.jpg', 'queued filename is stored');

  await mem.remove(id);
  items = await mem.list();
  eq(items.length, 0, 'remove clears the item');

  await mem.enqueue({ id: 'q1', filename: 'a.jpg', blob: 'A' });
  await mem.enqueue({ id: 'q2', filename: 'b.jpg', blob: 'B' });

  const uploaded = [];
  const result = await mem.flush(function (item) {
    uploaded.push(item.filename);
    return Promise.resolve({ id: 'drive-' + item.id });
  }, function () { return true; });
  eq(uploaded, ['a.jpg', 'b.jpg'], 'flush uploads in order');
  eq(result.uploadedIds, ['q1', 'q2'], 'flush reports uploaded ids');
  eq(result.remaining, 0, 'flush leaves the queue empty');

  await mem.enqueue({ id: 'q3', filename: 'offline.jpg', blob: 'C' });
  const skipped = await mem.flush(function () {
    throw new Error('should not upload while offline');
  }, function () { return false; });
  eq(skipped.uploadedIds, [], 'offline flush does not upload');
  eq(skipped.remaining, 1, 'offline flush keeps the item');

  let calls = 0;
  const failed = await mem.flush(function () {
    calls += 1;
    return Promise.reject(new Error('Failed to fetch'));
  }, function () { return true; });
  eq(calls, 1, 'failed upload is attempted once per flush');
  eq(failed.remaining, 1, 'failed offline-style upload stays queued');
  eq(failed.failed.length, 1, 'failed flush reports the error');
  ok(failed.failed[0].offline, 'failed fetch is marked offline');

  const recovered = await mem.flush(function () { return Promise.resolve(); }, function () { return true; });
  eq(recovered.uploadedIds, ['q3'], 'a later flush uploads the queued item');
  eq(recovered.remaining, 0, 'queue is empty after a successful retry');

  await mem.enqueue({ id: 'q4', filename: 'held.jpg', blob: 'D' });
  const heldUrl = globalThis.UPLOAD_URL;
  const heldToken = globalThis.UPLOAD_TOKEN;
  globalThis.UPLOAD_URL = 'PASTE_DEPLOYMENT_URL';
  globalThis.UPLOAD_TOKEN = 'N33AecjgX-NPQnwxLczfbQgIFJJEQypF';
  const held = await drive.flushQueue(mem, function () { return true; });
  eq(held.uploadedIds, [], 'unconfigured flush does not upload');
  eq(held.remaining, 1, 'unconfigured flush keeps the queued item');
  if (heldUrl === undefined) delete globalThis.UPLOAD_URL; else globalThis.UPLOAD_URL = heldUrl;
  if (heldToken === undefined) delete globalThis.UPLOAD_TOKEN; else globalThis.UPLOAD_TOKEN = heldToken;
  await mem.remove('q4');
}

runQueueTests().then(function () {
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failures.length) {
    failures.forEach(function (f) { console.log('FAIL: ' + f); });
    process.exit(1);
  }
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
