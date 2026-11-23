'use strict';

const assert = require('assert');
const path = require('path');
const parser = require(path.join(__dirname, '..', 'parse.js'));

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

// --- Sample receipt OCR texts ---

const WALMART = `
WALMART
Store #1234
11/18/2026  14:32

BANANAS            1.27
MILK               3.49
SUBTOTAL           4.76
TAX                0.38
TOTAL             $5.14
`;

const STARBUCKS = `
STARBUCKS COFFEE
Nov 18, 2026
Grande Latte       5.45
Tax                0.49
Amount Due        $5.94
`;

const ISO_GRAND = `
ACME MARKET
Date: 2026-11-18
Bread              3.00
Butter             4.00
SUBTOTAL           7.00
TAX                0.56
GRAND TOTAL       7.56
`;

const EUROPEAN = `
Boulangerie Dupont
18-11-2026
Pain               4,50
Cafe               3,00
TVA                0,70
TOTAL             8,20 €
`;

const CAD_RECEIPT = `
TIM HORTONS
18-Nov-2026
Coffee             1.80
Donut              1.50
SUBTOTAL           3.30
TAX                0.43
TOTAL          CAD 3.73
`;

const TWO_DIGIT_YEAR = `
Corner Store
11/18/26
Water              1.25
Chips              2.00
TOTAL             $3.25
`;

const BALANCE_DUE = `
City Garage
November 8, 2026
Labor            120.00
Parts             45.00
SUBTOTAL         165.00
TAX               13.20
TIP               10.00
CHANGE             0.00
BALANCE DUE     $178.20
`;

const AMBIGUOUS_US = `
Cafe
05/06/2026
Cookie             2.00
TOTAL             $2.00
`;

const FALLBACK_LARGEST = `
Mystery Shop
2026-11-21
Item A            12.00
Item B             4.50
Item C             9.99
`;

const GBP = `
Tesco
21 November 2026
Milk               1.10
Eggs               2.40
TOTAL             £3.50
`;

const NO_DATE = `
Some Store
Soda               1.50
TOTAL             $1.50
`;

const CHARGED = `
Uber Trip
12/01/2026
Fare              14.20
Fee                2.00
SUBTOTAL          16.20
TAX                0.80
CHARGED          $17.00
`;

const DOT_SEPARATED = `
Shop
11.18.2026
Item               9.00
TOTAL             $9.00
`;

// Dates
eq(parser.parseReceipt(WALMART).date, '2026-11-18', 'Walmart MM/DD/YYYY date');
eq(parser.parseReceipt(STARBUCKS).date, '2026-11-18', 'Starbucks Mon DD, YYYY date');
eq(parser.parseReceipt(ISO_GRAND).date, '2026-11-18', 'ISO YYYY-MM-DD date');
eq(parser.parseReceipt(EUROPEAN).date, '2026-11-18', 'European DD-MM-YYYY (day first because 18>12)');
eq(parser.parseReceipt(CAD_RECEIPT).date, '2026-11-18', 'DD-Mon-YYYY date');
eq(parser.parseReceipt(TWO_DIGIT_YEAR).date, '2026-11-18', 'MM/DD/YY date expands to 20xx');
eq(parser.parseReceipt(BALANCE_DUE).date, '2026-11-08', 'Month name first, no comma required');
eq(parser.parseReceipt(AMBIGUOUS_US).date, '2026-05-06', 'Ambiguous 05/06/2026 is US month-first (May 6)');
eq(parser.parseReceipt(AMBIGUOUS_US).dateConfidence, 'medium', 'Ambiguous numeric date is medium confidence');
eq(parser.parseReceipt(GBP).date, '2026-11-21', 'DD Month YYYY date');
eq(parser.parseReceipt(NO_DATE).date, null, 'Missing date is null');
eq(parser.parseReceipt(NO_DATE).dateConfidence, 'none', 'Missing date confidence is none');
eq(parser.parseReceipt(DOT_SEPARATED).date, '2026-11-18', 'MM.DD.YYYY date');
eq(parser.parseReceipt(CHARGED).date, '2026-12-01', 'MM/DD/YYYY December date');

// Amounts — prefer TOTAL-like labels, skip subtotal/tax/tip/change
eq(parser.parseReceipt(WALMART).amount, 5.14, 'Walmart TOTAL, not subtotal or tax');
eq(parser.parseReceipt(STARBUCKS).amount, 5.94, 'Amount Due is used as the total');
eq(parser.parseReceipt(ISO_GRAND).amount, 7.56, 'GRAND TOTAL preferred');
eq(parser.parseReceipt(EUROPEAN).amount, 8.20, 'European decimal comma amount');
eq(parser.parseReceipt(CAD_RECEIPT).amount, 3.73, 'CAD total amount');
eq(parser.parseReceipt(TWO_DIGIT_YEAR).amount, 3.25, 'Two-digit year receipt total');
eq(parser.parseReceipt(BALANCE_DUE).amount, 178.20, 'BALANCE DUE, ignoring tip/change/tax/subtotal');
eq(parser.parseReceipt(FALLBACK_LARGEST).amount, 12.00, 'Fallback to largest money value');
eq(parser.parseReceipt(FALLBACK_LARGEST).amountConfidence, 'low', 'Fallback amount confidence is low');
eq(parser.parseReceipt(GBP).amount, 3.50, 'GBP total');
eq(parser.parseReceipt(CHARGED).amount, 17.00, 'CHARGED line is used as the total');
ok(parser.parseReceipt(STARBUCKS).amountConfidence === 'high', 'Labeled total has high amount confidence');

// Currency
eq(parser.parseReceipt(WALMART).currency, 'USD', 'Dollar sign defaults to USD');
eq(parser.parseReceipt(EUROPEAN).currency, 'EUR', 'Euro symbol');
eq(parser.parseReceipt(CAD_RECEIPT).currency, 'CAD', 'CAD code');
eq(parser.parseReceipt(GBP).currency, 'GBP', 'Pound symbol');
eq(parser.parseReceipt(NO_DATE).currency, 'USD', 'Dollar sign is USD');

// Filenames
eq(parser.buildFilename('2026-11-18', 5.94, 'USD'), '2026-11-18 $5.94.jpg', 'USD filename uses $ and 2 decimals');
eq(parser.buildFilename('2026-11-18', 8.2, 'EUR'), '2026-11-18 €8.20.jpg', 'EUR filename uses € and pads decimals');
eq(parser.buildFilename('2026-11-21', 3.5, 'GBP'), '2026-11-21 £3.50.jpg', 'GBP filename uses £');
eq(parser.buildFilename('2026-11-18', 3.73, 'CAD'), '2026-11-18 CAD 3.73.jpg', 'CAD filename uses the code');
eq(parser.buildFilename(null, 1.5, 'USD'), 'undated $1.50.jpg', 'Missing date uses undated');
eq(
  parser.sanitizeFilename('2026-11-18 $5.94/evil*.jpg'),
  '2026-11-18 $5.94-evil-.jpg',
  'Illegal filename characters are replaced'
);

eq(parser.parseReceipt(STARBUCKS).filename, 'Starbucks 2026-11-18 $5.94.jpg', 'End-to-end Starbucks filename');
eq(parser.parseReceipt(EUROPEAN).filename, 'Boulangerie Dupont 2026-11-18 €8.20.jpg', 'End-to-end European filename');
eq(parser.parseReceipt(CAD_RECEIPT).filename, 'Tim Hortons 2026-11-18 CAD 3.73.jpg', 'End-to-end CAD filename');


// Merchant extraction and filenames
eq(parser.parseReceipt(STARBUCKS).merchant, 'Starbucks', 'Known brand Starbucks (ignores COFFEE suffix)');
eq(parser.parseReceipt(STARBUCKS).merchantConfidence, 'high', 'Known brand has high merchant confidence');
eq(parser.parseReceipt(WALMART).merchant, 'Walmart', 'Known brand Walmart from ALL CAPS');
eq(parser.parseReceipt(WALMART).filename, 'Walmart 2026-11-18 $5.14.jpg', 'Walmart filename starts with merchant');
eq(parser.parseReceipt(ISO_GRAND).merchant, 'Acme Market', 'Heuristic title-cases ALL CAPS merchant');
eq(parser.parseReceipt(EUROPEAN).merchant, 'Boulangerie Dupont', 'Mixed-case merchant is left as-is');
eq(parser.parseReceipt(CAD_RECEIPT).merchant, 'Tim Hortons', 'TIM HORTONS becomes Tim Hortons');
eq(parser.parseReceipt(TWO_DIGIT_YEAR).merchant, 'Corner Store', 'Corner Store heuristic');
eq(parser.parseReceipt(GBP).merchant, 'Tesco', 'Tesco heuristic');

eq(parser.buildFilename('2026-11-18', 5.94, 'USD', 'Starbucks'), 'Starbucks 2026-11-18 $5.94.jpg', 'Filename puts merchant first');
eq(parser.buildFilename('2026-11-18', 5.94, 'USD', ''), '2026-11-18 $5.94.jpg', 'Empty merchant falls back to old format');
eq(parser.buildFilename('2026-11-18', 5.94, 'USD', null), '2026-11-18 $5.94.jpg', 'Missing merchant falls back to old format');
eq(
  parser.buildFilename('2026-11-18', 12.5, 'USD', "Ben & Jerry's"),
  "Ben & Jerry's 2026-11-18 $12.50.jpg",
  'Apostrophes and ampersands are kept in merchant filenames'
);
eq(
  parser.buildFilename('2026-11-18', 1, 'USD', 'Foo/Bar:Baz'),
  'Foo-Bar-Baz 2026-11-18 $1.00.jpg',
  'Illegal merchant filename characters are replaced'
);

const ADDRESS_FIRST = `
123 Main Street
Suite 200
Springfield, IL 62701
JOE'S PIZZA
11/18/2026
Pepperoni          14.00
TAX                 1.12
TOTAL             $15.12
`;
eq(parser.parseReceipt(ADDRESS_FIRST).merchant, "Joe's Pizza", 'Address-first receipt uses the first real merchant line');
eq(parser.parseReceipt(ADDRESS_FIRST).filename, "Joe's Pizza 2026-11-18 $15.12.jpg", 'Address-first filename');

const JUNK_FIRST = `
WELCOME
Receipt
Store #1234
Tel: (555) 123-4567
www.cornermarket.com
11/18/2026  14:32
Cashier: Maya
Register 3
CORNER MARKET
Bananas             1.27
TOTAL              $1.27
`;
eq(parser.parseReceipt(JUNK_FIRST).merchant, 'Corner Market', 'Junk-first receipt skips welcome/receipt/store/tel/url/date/cashier');

const BRAND_AFTER_JUNK = `
Welcome
Thank you for shopping
Receipt
Store #55
Items
  Milk              3.49
Sold at WALGREENS
TAX                 0.28
TOTAL              $3.77
Date 11/18/2026
`;
eq(parser.parseReceipt(BRAND_AFTER_JUNK).merchant, 'Walgreens', 'Known brand is found even if it appears later in the text');
eq(parser.parseReceipt(BRAND_AFTER_JUNK).merchantConfidence, 'high', 'Later known brand still has high confidence');

const TARGET_ADDRESS_FIRST = `
900 Nicollet Mall
Minneapolis, MN 55403
(612) 555-0199
TARGET
11/18/2026
Socks               6.00
TOTAL              $6.00
`;
eq(parser.parseReceipt(TARGET_ADDRESS_FIRST).merchant, 'Target', 'Known brand Target after an address block');

const KNOWN_CASES = [
  ["lowe's #1822\nTOTAL $4.00", "Lowe's", "Lowe's apostrophe variant"],
  ["MCDONALDS\nOrder 12\nTOTAL $8.50", "McDonald's", "McDonald's without apostrophe"],
  ["Trader Joes\nNov 18, 2026\nTOTAL $11.00", "Trader Joe's", "Trader Joe's without apostrophe"],
  ["WHOLE FOODS MARKET\nTOTAL $22.00", "Whole Foods", "Whole Foods Market canonical name"],
  ["Total Wine & More\nTOTAL $19.99", "Total Wine", "Total Wine & More canonical name"],
  ["The Home Depot\nTOTAL $40.00", "Home Depot", "The Home Depot canonical name"],
  ["CVS Pharmacy\nTOTAL $9.00", "CVS", "CVS stays an acronym"],
  ["HARRIS TEETER\nTOTAL $16.20", "Harris Teeter", "Harris Teeter known brand"],
  ["Wawa\nTOTAL $5.00", "Wawa", "Wawa known brand"],
  ["exxon mobil\nTOTAL $40.10", "Exxon", "Exxon Mobil canonical name"]
];
KNOWN_CASES.forEach(function (row) {
  eq(parser.parseMerchant(row[0]).merchant, row[1], row[2]);
});

eq(parser.cleanMerchant('BP'), 'BP', 'Short no-vowel acronym BP stays upper');
eq(parser.cleanMerchant('CVS'), 'CVS', 'Short acronym CVS stays upper');

const NO_MERCHANT = `
11/18/2026
(555) 000-1111
123 Oak Road
TOTAL             $5.00
`;
eq(parser.parseReceipt(NO_MERCHANT).merchant, null, 'No merchant when only date, phone, and address are present');
eq(parser.parseReceipt(NO_MERCHANT).merchantConfidence, 'none', 'Missing merchant is flagged none / uncertain');
eq(parser.parseReceipt(NO_MERCHANT).filename, '2026-11-18 $5.00.jpg', 'Missing merchant keeps the old filename format');

eq(
  parser.cleanMerchant('VERY LONG SUPERMARKET NAME WITH TOO MANY EXTRA WORDS IN A ROW'),
  'Very Long Supermarket Name With Too',
  'Merchant names are trimmed to about 40 characters on a word boundary'
);

// Numeric amount helpers
eq(parser.parseNumericAmount('1,234.56'), 1234.56, 'US thousands amount');
eq(parser.parseNumericAmount('1.234,56'), 1234.56, 'European thousands amount');
eq(parser.parseNumericAmount('8,20'), 8.2, 'European decimal comma');

console.log(passed + ' passed, ' + failed + ' failed');
if (failures.length) {
  failures.forEach(function (f) {
    console.log('FAIL: ' + f);
  });
  process.exit(1);
}
