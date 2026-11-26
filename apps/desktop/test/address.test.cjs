const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAddress } = require('../address.cjs');

const cases = [
  ['localhost:8787', 'http://localhost:8787'],
  ['http://192.168.1.20:8787/settings', 'http://192.168.1.20:8787'],
  ['https://mainframe.example/', 'https://mainframe.example'],
  ['javascript:alert(1)', null],
  ['file:///c:/', null],
  ['', null],
  ['  localhost:8787  ', 'http://localhost:8787'],
  ['mainframe.example:8787/settings?tab=home#status', 'http://mainframe.example:8787'],
  ['mainframe.example', 'http://mainframe.example'],
  ['HTTPS://mainframe.example:443/settings', 'https://mainframe.example'],
  ['http://localhost:8787/?tab=home#status', 'http://localhost:8787'],
  ['ftp://mainframe.example', null],
  ['mailto:hello@example.com', null],
  ['custom:payload', null],
  ['http://', null],
  ['https://?query=1', null],
  ['localhost:99999', null],
  ['http://bad host.example', null],
  ['   ', null],
  [null, null],
  [undefined, null],
  [42, null]
];

for (const [input, expected] of cases) {
  test(`normalizeAddress(${JSON.stringify(input)})`, () => {
    assert.equal(normalizeAddress(input), expected);
  });
}
