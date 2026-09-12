const test = require('node:test');
const assert = require('node:assert/strict');
const { mainWindowChrome } = require('../electron/window-chrome.cjs');

test('uses a hidden title bar overlay only on Windows', () => {
  const options = mainWindowChrome('win32');
  assert.equal(options.titleBarStyle, 'hidden');
  assert.equal(options.autoHideMenuBar, true);
  assert.equal(options.titleBarOverlay.height, 56);
});

test('keeps the existing macOS title bar style unchanged', () => {
  assert.deepEqual(mainWindowChrome('darwin'), { titleBarStyle: 'hiddenInset' });
});
