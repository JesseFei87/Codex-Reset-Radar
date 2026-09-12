const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(async () => {
  const assets = path.join(__dirname, '..', 'electron', 'assets');
  const svg = fs.readFileSync(path.join(assets, 'tray-iconTemplate.svg'), 'utf8');
  const window = new BrowserWindow({ width: 36, height: 36, show: false, frame: false, transparent: true, backgroundColor: '#00000000' });
  const html = `<style>html,body{width:36px;height:36px;margin:0;overflow:hidden;background:transparent}</style>${svg}`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const source = await window.webContents.capturePage({ x: 0, y: 0, width: 36, height: 36 });
  if (source.isEmpty()) throw new Error('Electron could not render the tray icon');
  fs.writeFileSync(path.join(assets, 'tray-iconTemplate.png'), source.resize({ width: 18, height: 18, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(assets, 'tray-iconTemplate@2x.png'), source.resize({ width: 36, height: 36, quality: 'best' }).toPNG());
  for (const name of ['tray-iconTemplate.png', 'tray-iconTemplate@2x.png']) {
    const image = nativeImage.createFromPath(path.join(assets, name));
    if (image.isEmpty()) throw new Error(`${name} could not be loaded`);
    const bitmap = image.toBitmap();
    let visiblePixels = 0;
    for (let offset = 3; offset < bitmap.length; offset += 4) if (bitmap[offset]) visiblePixels += 1;
    if (visiblePixels < 30) throw new Error(`${name} does not contain enough visible pixels`);
    console.log(`${name}: ${image.getSize().width}x${image.getSize().height}, ${visiblePixels} visible pixels`);
  }
  window.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
