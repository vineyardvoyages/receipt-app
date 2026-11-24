/**
 * Receipts upload endpoint.
 * Deploy as a web app: Execute as: Me, Who has access: Anyone.
 * Clients POST text/plain JSON: {filename, mimeType, data (base64), token}.
 */
var UPLOAD_TOKEN = 'N33AecjgX-NPQnwxLczfbQgIFJJEQypF';
var PARENT_FOLDER_NAME = 'Vineyard Voyages';
var RECEIPTS_FOLDER_NAME = 'Receipts';
var FOLDER_CACHE_KEY = 'receiptsFolderId';
var MAX_BYTES = 10 * 1024 * 1024;

function doGet() {
  return json_({ ok: true });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'Missing request body.' });
    }
    var body = JSON.parse(e.postData.contents);
    if (!body || body.token !== UPLOAD_TOKEN) {
      return json_({ ok: false, error: 'Unauthorized.' });
    }

    var mimeType = String(body.mimeType || 'image/jpeg').toLowerCase();
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/jpg') {
      return json_({ ok: false, error: 'Only JPEG images are accepted.' });
    }

    var raw = String(body.data || '').replace(/\s+/g, '');
    if (!raw) {
      return json_({ ok: false, error: 'Missing image data.' });
    }
    var bytes = Utilities.base64Decode(raw);
    if (!bytes || !bytes.length) {
      return json_({ ok: false, error: 'Missing image data.' });
    }
    if (bytes.length > MAX_BYTES) {
      return json_({ ok: false, error: 'The image is too large (max 10MB).' });
    }
    if (bytes.length < 3 || (bytes[0] & 0xff) !== 0xff || (bytes[1] & 0xff) !== 0xd8) {
      return json_({ ok: false, error: 'The file is not a valid JPEG.' });
    }

    var filename = sanitizeFilename_(body.filename);
    var folder = getReceiptsFolder_();
    var blob = Utilities.newBlob(bytes, 'image/jpeg', filename);
    var file = folder.createFile(blob).setName(filename);
    return json_({
      ok: true,
      id: file.getId(),
      name: file.getName(),
      url: file.getUrl()
    });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sanitizeFilename_(name) {
  var s = String(name || 'receipt.jpg')
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = 'receipt.jpg';
  if (!/\.jpe?g$/i.test(s)) s += '.jpg';
  if (s.length > 180) {
    s = s.slice(0, 176).replace(/\s+$/, '') + '.jpg';
  }
  return s;
}

function getReceiptsFolder_() {
  var props = PropertiesService.getScriptProperties();
  var cachedId = props.getProperty(FOLDER_CACHE_KEY);
  if (cachedId) {
    try {
      var cached = DriveApp.getFolderById(cachedId);
      if (cached && !cached.isTrashed() &&
          cached.getName().toLowerCase() === RECEIPTS_FOLDER_NAME.toLowerCase()) {
        return cached;
      }
    } catch (err) {
      // Cached id is stale; look up the folder again.
    }
  }

  var parent = findFolderInRoot_(PARENT_FOLDER_NAME);
  if (!parent) {
    throw new Error("Could not find a folder named 'Vineyard Voyages' in My Drive.");
  }
  var receipts = findChildFolder_(parent, RECEIPTS_FOLDER_NAME);
  if (!receipts) {
    receipts = parent.createFolder(RECEIPTS_FOLDER_NAME);
  }
  props.setProperty(FOLDER_CACHE_KEY, receipts.getId());
  return receipts;
}

function findFolderInRoot_(name) {
  var wanted = String(name).toLowerCase();
  var iter = DriveApp.getRootFolder().getFolders();
  while (iter.hasNext()) {
    var folder = iter.next();
    if (!folder.isTrashed() && folder.getName().toLowerCase() === wanted) {
      return folder;
    }
  }
  return null;
}

function findChildFolder_(parent, name) {
  var wanted = String(name).toLowerCase();
  var iter = parent.getFolders();
  while (iter.hasNext()) {
    var folder = iter.next();
    if (!folder.isTrashed() && folder.getName().toLowerCase() === wanted) {
      return folder;
    }
  }
  return null;
}
