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

// Picked folder: Receipts vs parent
eq(drive.decidePickedFolder({ id: 'abc', name: 'Receipts' }).kind, 'receipts', 'Picking Receipts uses it directly');
eq(drive.decidePickedFolder({ id: 'abc', name: 'receipts' }).kind, 'receipts', 'Receipts match is case-insensitive');
eq(drive.decidePickedFolder({ id: 'vv', name: 'Vineyard Voyages' }).kind, 'parent', 'Picking Vineyard Voyages treats it as the parent');
eq(drive.decidePickedFolder({ id: 'vv', name: 'Vineyard Voyages' }).id, 'vv', 'Parent id is preserved');

eq(drive.folderPath({ parentName: 'Vineyard Voyages', receiptsFolderName: 'Receipts' }), 'Vineyard Voyages / Receipts', 'Folder path display');
eq(drive.folderPath({ parentName: '', receiptsFolderName: 'Receipts' }), 'Receipts', 'Path falls back to Receipts alone');
ok(drive.PICKER_TITLE.indexOf('Vineyard Voyages') !== -1, 'Picker title mentions Vineyard Voyages');
ok(drive.PICKER_TITLE.indexOf('Receipts') !== -1, 'Picker title mentions Receipts');
eq(drive.LOGIN_HINT, 'choeffel@gmail.com', 'Login hint is choeffel@gmail.com');

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
