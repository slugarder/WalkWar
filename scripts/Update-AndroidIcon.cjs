// Generate density resources without running prebuild over the native project.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const mobile = path.resolve(__dirname, '../mobile');
const mobileRequire = createRequire(path.join(mobile, 'package.json'));
const { setIconAsync } = mobileRequire('@expo/prebuild-config/build/plugins/icons/withAndroidIcons');

(async () => {
  await setIconAsync(mobile, {
    icon: path.join(mobile, 'assets/icon.png'), foregroundImage: path.join(mobile, 'assets/icon.png'),
    backgroundColor: '#081520', backgroundImage: null,
    monochromeImage: null, isAdaptive: true,
  });
  const res = path.join(mobile, 'android/app/src/main/res');
  // Keep the complete flattened artwork inside Android's 66dp safe circle.
  // Positioning is handled by the drawable; the supplied PNG stays unchanged.
  await fs.writeFile(path.join(res, 'drawable/walkwar_launcher_foreground.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<inset xmlns:android="http://schemas.android.com/apk/res/android" android:inset="24dp" android:drawable="@mipmap/ic_launcher_foreground"/>\n');
  const xml = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/iconBackground"/>\n    <foreground android:drawable="@drawable/walkwar_launcher_foreground"/>\n</adaptive-icon>\n';
  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    await fs.writeFile(path.join(res, 'mipmap-anydpi-v26', name), xml);
  }
  console.log('WalkWar launcher resources generated; original artwork preserved.');
})().catch(error => { console.error(error); process.exitCode = 1; });
