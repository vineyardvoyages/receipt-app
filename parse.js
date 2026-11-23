/**
 * Receipt text parser. Works in the browser (global ReceiptParser)
 * and in Node (module.exports) so the same code can be unit-tested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReceiptParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
  };

  var MONTH_NAME =
    'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|' +
    'jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

  var CURRENCY_CODES = {
    USD: '$', EUR: '€', GBP: '£', JPY: '¥',
    CAD: null, AUD: null, NZD: null, MXN: null,
    INR: null, CHF: null, CNY: null, HKD: null, SGD: null
  };

  var SYMBOL_TO_CODE = {
    '$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '¥': 'JPY',
    '₹': 'INR'
  };

  var EXCLUDE_LINE =
    /\b(sub[\s\-]*totals?|sales\s*tax|vat|gst|hst|pst|qst|tax(?:es)?|tip|gratuity|change|cash(?:\s*(?:tendered|given|paid|back))?|tender(?:ed)?|savings?|discounts?|deposits?|coupons?|qty|quantity)\b/i;

  var TOTAL_LINE =
    /\b((?:grand|invoice|order|card|visa|mastercard|mc|amex|discover|debit|credit)\s+total|total\s+(?:due|amount|charged|purchase|sales?)|amount\s+(?:due|charged|paid|tendered)?|balance(?:\s+due)?|charged|please\s+pay|you\s+(?:paid|pay)|payment(?:\s+due)?|total)\b/i;

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function expandYear(y) {
    if (y < 100) return y >= 70 ? 1900 + y : 2000 + y;
    return y;
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function makeDate(y, m, d) {
    y = expandYear(Number(y));
    m = Number(m);
    d = Number(d);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (y < 1990 || y > 2099) return null;
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > daysInMonth(y, m)) return null;
    return {
      year: y,
      month: m,
      day: d,
      iso: y + '-' + pad(m) + '-' + pad(d)
    };
  }

  function monthNum(name) {
    return MONTHS[String(name).toLowerCase().replace(/\./g, '')] || null;
  }

  function lineContext(text, index) {
    var start = text.lastIndexOf('\n', index);
    var end = text.indexOf('\n', index);
    if (start < 0) start = 0;
    else start += 1;
    if (end < 0) end = text.length;
    return text.slice(start, end);
  }

  function nearDateLabel(context) {
    return /\b(date|dated|txn|trans(?:action)?(?:\s*date)?|purchased|sold)\b/i.test(context);
  }

  function collectDates(text) {
    var candidates = [];

    function add(match, date, confidence, ambiguous) {
      if (!date) return;
      var ctx = lineContext(text, match.index);
      var score = confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
      if (nearDateLabel(ctx)) score += 2;
      if (date.year >= 2000) score += 0.5;
      candidates.push({
        date: date,
        confidence: confidence,
        ambiguous: !!ambiguous,
        score: score,
        index: match.index
      });
    }

    var isoRe = /\b((?:19|20)\d{2})[.\/\-](\d{1,2})[.\/\-](\d{1,2})\b/g;
    var m;
    while ((m = isoRe.exec(text))) {
      add(m, makeDate(m[1], m[2], m[3]), 'high', false);
    }

    var monFirst = new RegExp(
      '\\b(' + MONTH_NAME + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{2,4})\\b',
      'gi'
    );
    while ((m = monFirst.exec(text))) {
      var mon = monthNum(m[1]);
      var conf = String(m[3]).length === 4 ? 'high' : 'medium';
      add(m, makeDate(m[3], mon, m[2]), conf, false);
    }

    var dayMon = new RegExp(
      '\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s.\\-]+(' + MONTH_NAME + ')\\.?[\\s.,\\-]+(\\d{2,4})\\b',
      'gi'
    );
    while ((m = dayMon.exec(text))) {
      mon = monthNum(m[2]);
      conf = String(m[3]).length === 4 ? 'high' : 'medium';
      add(m, makeDate(m[3], mon, m[1]), conf, false);
    }

    var numeric = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g;
    while ((m = numeric.exec(text))) {
      var a = Number(m[1]);
      var b = Number(m[2]);
      var y = m[3];
      // Skip ISO years already handled (would require a 4-digit first group).
      var ambiguous = false;
      var date = null;
      if (a > 12 && b <= 12) {
        date = makeDate(y, b, a);
        conf = String(y).length === 4 ? 'high' : 'medium';
      } else if (a <= 12 && b > 12) {
        date = makeDate(y, a, b);
        conf = String(y).length === 4 ? 'high' : 'medium';
      } else if (a <= 12 && b <= 12) {
        date = makeDate(y, a, b); // US month-first when ambiguous
        ambiguous = true;
        conf = String(y).length === 4 ? 'medium' : 'low';
      } else {
        continue;
      }
      add(m, date, conf, ambiguous);
    }

    candidates.sort(function (x, y) {
      if (y.score !== x.score) return y.score - x.score;
      return x.index - y.index;
    });
    return candidates;
  }

  function parseNumericAmount(raw) {
    if (!raw) return null;
    var s = String(raw).replace(/\s/g, '').replace(/^\(/, '-').replace(/\)$/, '');
    if (!s || !/\d/.test(s)) return null;

    var value;
    if (/^-?\d{1,3}(,\d{3})+(\.\d{1,2})$/.test(s)) {
      value = Number(s.replace(/,/g, ''));
    } else if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})$/.test(s)) {
      value = Number(s.replace(/\./g, '').replace(',', '.'));
    } else if (/^-?\d+,\d{2}$/.test(s)) {
      value = Number(s.replace(',', '.'));
    } else if (/^-?\d+\.\d{1,2}$/.test(s)) {
      value = Number(s);
    } else if (/^-?\d+$/.test(s)) {
      value = Number(s);
    } else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) {
      value = Number(s.replace(/,/g, ''));
    } else {
      return null;
    }
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100) / 100;
  }

  function detectCurrencyIn(text) {
    if (!text) return null;
    var ca = text.match(/\b(?:CAD|C(?:A)?\$)/i) || text.match(/\$\s*CAD\b/i);
    if (ca) return { code: 'CAD', confidence: 'high' };
    var au = text.match(/\b(?:AUD|A(?:U)?\$)/i);
    if (au) return { code: 'AUD', confidence: 'high' };
    var nz = text.match(/\b(?:NZD|NZ\$)/i);
    if (nz) return { code: 'NZD', confidence: 'high' };
    var mx = text.match(/\b(?:MXN|MX\$)/i);
    if (mx) return { code: 'MXN', confidence: 'high' };
    var us = text.match(/\b(?:USD|US\$)\b/i);
    if (us) return { code: 'USD', confidence: 'high' };

    var code = text.match(/\b(USD|EUR|GBP|CAD|AUD|NZD|MXN|JPY|INR|CHF|CNY|HKD|SGD)\b/i);
    if (code) return { code: code[1].toUpperCase(), confidence: 'high' };

    if (/€/.test(text)) return { code: 'EUR', confidence: 'high' };
    if (/£/.test(text)) return { code: 'GBP', confidence: 'high' };
    if (/¥/.test(text)) return { code: 'JPY', confidence: 'high' };
    if (/₹/.test(text)) return { code: 'INR', confidence: 'high' };
    if (/\$/.test(text)) return { code: 'USD', confidence: 'medium' };
    return null;
  }

  var CURRENCY_ATOM =
    '(?:(?:US|CA|AU|NZ|MX|C|A)?\\$|€|£|¥|₹|\\b(?:USD|EUR|GBP|CAD|AUD|NZD|MXN|JPY|INR|CHF)\\b)';
  var AMOUNT_ATOM =
    '(\\(?\\d{1,3}(?:[.,]\\d{3})+[.,]\\d{2}\\)?|\\(?\\d+[.,]\\d{2}\\)?|\\(?\\d{1,6}\\)?)';
  var MONEY_TOKEN = new RegExp(CURRENCY_ATOM + '?\\s*' + AMOUNT_ATOM + '\\s*' + CURRENCY_ATOM + '?', 'gi');

  function extractAmountsFromLine(line) {
    var found = [];
    var tokenRe = new RegExp(MONEY_TOKEN.source, 'gi');
    var m;
    while ((m = tokenRe.exec(line))) {
      var amount = parseNumericAmount(m[1]);
      if (amount == null) continue;
      // Ignore bare long integers that look like IDs, phones, or barcodes.
      var rawNum = m[1].replace(/[()]/g, '');
      var isPlainInt = /^\d+$/.test(rawNum);
      if (isPlainInt && rawNum.length >= 7) continue;
      // Skip bare years so dates like 2026-11-18 are not treated as amounts.
      if (isPlainInt && amount >= 1900 && amount <= 2099) continue;
      if (Math.abs(amount) > 1000000) continue;
      var slice = m[0];
      found.push({
        amount: amount,
        raw: m[0],
        hasDecimals: /[.,]\d{1,2}\)?$/.test(rawNum),
        currency: detectCurrencyIn(slice)
      });
    }
    return found;
  }

  function isExcludedLine(line) {
    if (!EXCLUDE_LINE.test(line)) return false;
    // "TOTAL" lines that happen to mention tax in a phrase like "total tax" stay excluded.
    // A true total line such as "TOTAL" should not be excluded just because the word
    // "total" is not an exclude term. "SUBTOTAL" is excluded via sub-total.
    return true;
  }

  function isTotalLine(line) {
    if (isExcludedLine(line)) return false;
    return TOTAL_LINE.test(line);
  }

  function collectAmounts(text) {
    var lines = String(text).split(/\r?\n/);
    var labeled = [];
    var unlabeled = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var amounts = extractAmountsFromLine(line);
      if (!amounts.length) continue;
      if (isExcludedLine(line)) continue;
      var bucket = isTotalLine(line) ? labeled : unlabeled;
      for (var j = 0; j < amounts.length; j++) {
        bucket.push(Object.assign({ line: line, lineIndex: i }, amounts[j]));
      }
    }
    return { labeled: labeled, unlabeled: unlabeled };
  }

  function pickAmount(collected) {
    function bestOf(list, confidence) {
      if (!list.length) return null;
      var withDec = list.filter(function (x) { return x.hasDecimals; });
      var pool = withDec.length ? withDec : list;
      pool = pool.slice().sort(function (a, b) { return b.amount - a.amount; });
      var pick = pool[0];
      return {
        amount: pick.amount,
        confidence: confidence,
        currency: pick.currency,
        line: pick.line
      };
    }

    var labeled = bestOf(collected.labeled, 'high');
    if (labeled) return labeled;
    var unlabeled = bestOf(collected.unlabeled, 'medium');
    if (unlabeled) {
      // A single standalone money value is a bit more trustworthy than "largest of many".
      if (collected.unlabeled.length === 1) unlabeled.confidence = 'medium';
      else unlabeled.confidence = 'low';
      return unlabeled;
    }
    return null;
  }


  var KNOWN_BRANDS = [
    { name: 'Starbucks', pattern: /\bstarbucks(?:\s+coffee)?\b/i },
    { name: 'Walmart', pattern: /\bwal[\s\-]?mart\b/i },
    { name: 'Target', pattern: /\btarget\b/i },
    { name: 'CVS', pattern: /\bcvs(?:\s+pharmacy)?\b/i },
    { name: 'Walgreens', pattern: /\bwalgreens\b/i },
    { name: 'Costco', pattern: /\bcostco(?:\s+wholesale)?\b/i },
    { name: 'Home Depot', pattern: /\b(?:the\s+)?home\s+depot\b/i },
    { name: "Lowe's", pattern: /\blowe'?s\b/i },
    { name: "McDonald's", pattern: /\bmc\s*donald'?s\b/i },
    { name: 'Wawa', pattern: /\bwawa\b/i },
    { name: 'Sheetz', pattern: /\bsheetz\b/i },
    { name: 'Shell', pattern: /\bshell\b/i },
    { name: 'Exxon', pattern: /\bexxon(?:\s*mobil)?\b/i },
    { name: 'Giant', pattern: /\bgiant(?:\s+foods?)?\b/i },
    { name: 'Safeway', pattern: /\bsafeway\b/i },
    { name: 'Harris Teeter', pattern: /\bharris\s+teeter\b/i },
    { name: 'Wegmans', pattern: /\bwegmans\b/i },
    { name: "Trader Joe's", pattern: /\btrader\s+joe'?s\b/i },
    { name: 'Whole Foods', pattern: /\bwhole\s+foods(?:\s+market)?\b/i },
    { name: 'Amazon', pattern: /\bamazon(?:\s+(?:fresh|go|market|grocery))?\b/i },
    { name: 'Total Wine', pattern: /\btotal\s+wine(?:\s*&\s*more)?\b/i }
  ];

  var SKIP_MERCHANT_LINE =
    /^\s*(welcome(?:\s+to\b)?|thanks?(?:\s+you)?|thank\s+you(?:\s+for\b)?|receipt|invoice|tax\s+invoice|customer\s+copy|merchant\s+copy|duplicate|void|store\s*#|store\s+(?:no\.?|number|id)\b|tel\b|telephone|phone\b|fax\b|cashier|clerk|register|terminal|lane\b|served\s+by|you\s+were\s+served|operator|associate|employee|manager|server\b)/i;

  function letterCount(s) {
    return (String(s).match(/[A-Za-z]/g) || []).length;
  }

  function digitCount(s) {
    return (String(s).match(/\d/g) || []).length;
  }

  function isMostlyDigits(line) {
    var letters = letterCount(line);
    var digits = digitCount(line);
    if (digits === 0) return false;
    return letters === 0 || digits >= letters * 2;
  }

  function isPhoneLine(line) {
    return /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/.test(line);
  }

  function isUrlLine(line) {
    return /(?:https?:\/\/|www\.)/i.test(line) ||
      /\b[\w.-]+\.(?:com|net|org|io|co|edu|us)\b/i.test(line) ||
      /@[\w.-]+\.[A-Za-z]{2,}/.test(line);
  }

  function isAddressLine(line) {
    if (/\b\d{1,6}\s+(?:[A-Za-z0-9.''\-]+\s+){0,4}(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|hwy|highway|pkwy|parkway|cir|circle|pl|place|sq|square)\b\.?/i.test(line)) {
      return true;
    }
    if (/\b(?:suite|ste|apt|apartment|unit|fl|floor|bldg|building)\.?\s*[A-Za-z0-9]+\b/i.test(line)) return true;
    if (/\bp\.?\s*o\.?\s*box\b/i.test(line)) return true;
    if (/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(line)) return true;
    if (/\b\d{5}(?:-\d{4})?\b/.test(line) && /[A-Za-z]/.test(line)) return true;
    if (/^[A-Za-z][A-Za-z .''\-]+,\s*(?:[A-Z]{2}|USA|US|UK|CA|CANADA)\b/i.test(line.trim())) return true;
    return false;
  }

  function isDateOrTimeLine(line) {
    var month = MONTH_NAME;
    var stripped = String(line)
      .replace(/\b((?:19|20)\d{2})[.\/\-](\d{1,2})[.\/\-](\d{1,2})\b/g, ' ')
      .replace(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g, ' ')
      .replace(new RegExp('\\b(' + month + ')\\b', 'gi'), ' ')
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]m)?\b/gi, ' ')
      .replace(/\b(?:date|time|dated|txn|trans(?:action)?)\b/gi, ' ')
      .replace(/[\s,.\-:\/#]+/g, '');
    return stripped.length < 3;
  }

  function shouldSkipMerchantLine(line) {
    var s = String(line).trim();
    if (!s) return true;
    if (letterCount(s) < 2) return true;
    if (isMostlyDigits(s)) return true;
    if (SKIP_MERCHANT_LINE.test(s)) return true;
    if (isPhoneLine(s)) return true;
    if (isUrlLine(s)) return true;
    if (isAddressLine(s)) return true;
    if (isDateOrTimeLine(s)) return true;
    if (isTotalLine(s) || isExcludedLine(s)) return true;
    // Item and total lines usually end with a price.
    if (/(?:\$|€|£)?\s*\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\s*(?:\$|€|£|[A-Z]{3})?\s*$/.test(s)) return true;
    return false;
  }

  function isMostlyLetters(line) {
    var letters = letterCount(line);
    var compact = String(line).replace(/\s/g, '').length;
    return letters >= 2 && compact > 0 && letters >= compact * 0.6;
  }

  function titleCaseWord(word) {
    if (!word) return word;
    var bare = word.replace(/[^A-Za-z]/g, '');
    var upper = word.toUpperCase();
    var isShortAcronym = word.length <= 4 &&
      /^[A-Za-z0-9&]+$/.test(word) &&
      (bare.length <= 4 && !/[AEIOU]/i.test(bare) || /^(CVS|BP|KFC|BBQ|USA|LLC|INC|IBM|UPS|BMW|AMC)$/i.test(bare));
    if (isShortAcronym) return upper;
    if (/^mc[a-z]/i.test(bare) && bare.length > 3) {
      var rest = word.slice(word.toLowerCase().indexOf('c') + 1);
      var lettersOnly = rest.replace(/^[^A-Za-z]+/, '');
      var idx = word.search(/c/i);
      var prefix = word.slice(0, idx + 1);
      var after = word.slice(idx + 1);
      return 'Mc' + (after.charAt(0).toUpperCase() + after.slice(1).toLowerCase());
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  function looksAllCaps(s) {
    return /[A-Z]/.test(s) && s === s.toUpperCase();
  }

  function toMerchantTitleCase(s) {
    var words = String(s).split(/\s+/);
    var allCaps = looksAllCaps(s.replace(/[^A-Za-z]/g, '') ? s : '');
    // Title-case ALL CAPS (or mostly caps) lines; leave already mixed names alone.
    var letters = s.replace(/[^A-Za-z]/g, '');
    var caps = (s.match(/[A-Z]/g) || []).length;
    var shouldTitle = allCaps || (letters.length >= 2 && caps / letters.length >= 0.8);
    if (!shouldTitle) return s;
    return words.map(titleCaseWord).join(' ');
  }

  function trimMerchant(s, maxLen) {
    maxLen = maxLen || 40;
    if (s.length <= maxLen) return s;
    var cut = s.slice(0, maxLen);
    var sp = cut.lastIndexOf(' ');
    if (sp >= Math.floor(maxLen / 2)) cut = cut.slice(0, sp);
    return cut.trim();
  }

  function cleanMerchant(raw) {
    if (!raw) return '';
    var s = String(raw).replace(/\s+/g, ' ').trim();
    s = s.replace(/^[^A-Za-z0-9&']+|[^A-Za-z0-9&']+$/g, '');
    s = s.replace(/[^A-Za-z0-9&'\s.\-]/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    s = toMerchantTitleCase(s);
    s = trimMerchant(s, 40);
    return s;
  }

  function findKnownBrand(text) {
    var source = String(text || '');
    var best = null;
    for (var i = 0; i < KNOWN_BRANDS.length; i++) {
      var brand = KNOWN_BRANDS[i];
      var re = new RegExp(brand.pattern.source, 'ig');
      var m = re.exec(source);
      if (!m) continue;
      var cand = { name: brand.name, index: m.index, length: m[0].length };
      if (!best || cand.index < best.index || (cand.index === best.index && cand.length > best.length)) {
        best = cand;
      }
    }
    return best;
  }

  function findHeuristicMerchant(text) {
    var lines = String(text || '').split(/\r?\n/);
    var seen = 0;
    for (var i = 0; i < lines.length && seen < 10; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;
      seen += 1;
      if (shouldSkipMerchantLine(raw)) continue;
      if (!isMostlyLetters(raw) && letterCount(raw) < 3) continue;
      var cleaned = cleanMerchant(raw);
      if (!cleaned || letterCount(cleaned) < 2) continue;
      return cleaned;
    }
    return '';
  }

  function parseMerchant(text) {
    var brand = findKnownBrand(text);
    if (brand) {
      return { merchant: brand.name, confidence: 'high' };
    }
    var guessed = findHeuristicMerchant(text);
    if (guessed) {
      return { merchant: guessed, confidence: 'medium' };
    }
    return { merchant: null, confidence: 'none' };
  }

  function currencyPrefix(code) {
    var c = (code || 'USD').toUpperCase();
    if (c === 'USD') return '$';
    if (c === 'EUR') return '€';
    if (c === 'GBP') return '£';
    return c + ' ';
  }

  function sanitizeFilename(name) {
    return String(name)
      .replace(/[\/\\:*?"<>|\x00-\x1f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildFilename(dateIso, amount, currency, merchant) {
    var datePart = dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : 'undated';
    var n = Number(amount);
    var amt = Number.isFinite(n) ? n.toFixed(2) : '0.00';
    var prefix = currencyPrefix(currency || 'USD');
    var money = prefix.endsWith(' ') ? prefix + amt : prefix + amt;
    var merch = sanitizeFilename(merchant || '').replace(/\.+$/g, '').trim();
    var base = merch ? merch + ' ' + datePart + ' ' + money + '.jpg' : datePart + ' ' + money + '.jpg';
    return sanitizeFilename(base);
  }

  function parseDate(text) {
    var candidates = collectDates(text || '');
    if (!candidates.length) {
      return { date: null, confidence: 'none', ambiguous: false };
    }
    var top = candidates[0];
    return {
      date: top.date.iso,
      confidence: top.confidence,
      ambiguous: top.ambiguous
    };
  }

  function parseReceipt(text) {
    text = String(text || '');
    var dateInfo = parseDate(text);
    var collected = collectAmounts(text);
    var amountInfo = pickAmount(collected);

    var currencyInfo = null;
    if (amountInfo && amountInfo.currency) currencyInfo = amountInfo.currency;
    if (!currencyInfo && amountInfo && amountInfo.line) currencyInfo = detectCurrencyIn(amountInfo.line);
    if (!currencyInfo) currencyInfo = detectCurrencyIn(text);
    if (!currencyInfo) currencyInfo = { code: 'USD', confidence: 'low' };

    var amount = amountInfo ? amountInfo.amount : null;
    var merchantInfo = parseMerchant(text);
    var filename = buildFilename(dateInfo.date, amount, currencyInfo.code, merchantInfo.merchant);

    return {
      date: dateInfo.date,
      amount: amount,
      currency: currencyInfo.code,
      merchant: merchantInfo.merchant,
      dateConfidence: dateInfo.confidence,
      amountConfidence: amountInfo ? amountInfo.confidence : 'none',
      currencyConfidence: currencyInfo.confidence,
      merchantConfidence: merchantInfo.confidence,
      filename: filename
    };
  }

  return {
    parseReceipt: parseReceipt,
    parseDate: parseDate,
    parseMerchant: parseMerchant,
    parseNumericAmount: parseNumericAmount,
    detectCurrencyIn: detectCurrencyIn,
    buildFilename: buildFilename,
    cleanMerchant: cleanMerchant,
    sanitizeFilename: sanitizeFilename,
    currencyPrefix: currencyPrefix
  };
});
