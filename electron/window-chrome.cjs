function mainWindowChrome(platform) {
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#070b12', symbolColor: '#80909e', height: 56 },
      autoHideMenuBar: true,
    };
  }
  return { titleBarStyle: platform === 'darwin' ? 'hiddenInset' : 'default' };
}

module.exports = { mainWindowChrome };
