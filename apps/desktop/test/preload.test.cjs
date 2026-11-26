const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../preload.cjs'), 'utf8');
const offlineUrl = pathToFileURL(path.join(__dirname, '../offline.html')).href;

function loadPreload(href, { subframe = false, argv = [`--mainframe-offline-url=${offlineUrl}`] } = {}) {
  const exposed = {};
  const calls = [];
  const window = { location: { href } };
  window.top = subframe ? {} : window;
  vm.runInNewContext(source, {
    window,
    URL,
    process: { argv },
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value; } },
        ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(); } }
      };
    }
  });
  return { exposed, calls };
}

for (const href of [
  'http://localhost:8787',
  'https://mainframe.example/offline.html',
  'file:///C:/unrelated/offline.html',
  'file:///C:/unrelated/other.html'
]) {
  test(`preload exposes no API to ${href}`, () => {
    assert.deepEqual(loadPreload(href).exposed, {});
  });
}

test('preload exposes only the three narrow methods to its own offline page', async () => {
  const { exposed, calls } = loadPreload(`${offlineUrl}?mode=address`);
  assert.deepEqual(Object.keys(exposed), ['mainframeDesktop']);
  assert.deepEqual(Object.keys(exposed.mainframeDesktop), ['getAddress', 'setAddress', 'retry']);
  await exposed.mainframeDesktop.getAddress();
  await exposed.mainframeDesktop.setAddress('localhost:8787');
  await exposed.mainframeDesktop.retry();
  assert.deepEqual(calls, [
    ['mainframe:get-address'],
    ['mainframe:set-address', 'localhost:8787'],
    ['mainframe:retry']
  ]);
});

test('preload exposes no API in a subframe or without the trusted local URL', () => {
  assert.deepEqual(loadPreload(offlineUrl, { subframe: true }).exposed, {});
  assert.deepEqual(loadPreload(offlineUrl, { argv: [] }).exposed, {});
});
