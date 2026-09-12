const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('ships macOS tray template PNGs at standard and Retina sizes', () => {
  for (const [name, size] of [['tray-iconTemplate.png', 18], ['tray-iconTemplate@2x.png', 36]]) {
    const png = fs.readFileSync(path.join(__dirname, '..', 'electron', 'assets', name));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.ok(png.length > 300);
  }
});
