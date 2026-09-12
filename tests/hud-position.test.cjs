const test = require('node:test');
const assert = require('node:assert/strict');
const { hudPosition } = require('../electron/hud-position.cjs');

test('places a HUD below a top menu-bar tray icon', () => {
  const result = hudPosition(
    { x: 900, y: 0, width: 20, height: 24 },
    { width: 420, height: 680 },
    { x: 0, y: 0, width: 1440, height: 900 },
  );
  assert.deepEqual(result, { x: 700, y: 32 });
});

test('places a HUD above a bottom taskbar and keeps it on screen', () => {
  const result = hudPosition(
    { x: 1910, y: 1040, width: 24, height: 24 },
    { width: 420, height: 680 },
    { x: 0, y: 0, width: 1920, height: 1040 },
  );
  assert.deepEqual(result, { x: 1492, y: 352 });
});
