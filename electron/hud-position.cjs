function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hudPosition(trayBounds, windowBounds, workArea) {
  const margin = 8;
  const x = clamp(
    Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2),
    workArea.x + margin,
    workArea.x + workArea.width - windowBounds.width - margin,
  );
  const trayNearTop = trayBounds.y < workArea.y + workArea.height / 2;
  const preferredY = trayNearTop
    ? trayBounds.y + trayBounds.height + margin
    : trayBounds.y - windowBounds.height - margin;
  const y = clamp(preferredY, workArea.y + margin, workArea.y + workArea.height - windowBounds.height - margin);
  return { x, y };
}

module.exports = { hudPosition };
