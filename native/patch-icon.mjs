import fs from 'node:fs';
import path from 'node:path';

const res = path.resolve('android/app/src/main/res');
for (const dir of ['drawable','mipmap-anydpi-v21','mipmap-anydpi-v26','values']) fs.mkdirSync(path.join(res, dir), { recursive: true });

const foreground = String.raw`<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="512" android:viewportHeight="512">
    <path android:fillColor="#090909" android:pathData="M70,176h112c39,0 67,22 67,56 0,26 -16,45 -42,52l52,61h-53l-44,-54h-33l-32,54H56l49,-84 42,-22h35c13,0 23,-5 23,-12s-10,-11 -24,-11H98z" />
    <path android:fillColor="#090909" android:pathData="M250,303h55c-18,0 -28,7 -28,14 0,8 11,13 31,14l25,2c35,3 54,16 54,41 0,28 -25,47 -62,47h-84v-34h77c14,0 22,-5 22,-12 0,-6 -8,-10 -24,-11l-26,-2c-34,-3 -52,-17 -52,-44 0,-10 4,-20 12,-28z" />
    <path android:fillColor="#090909" android:pathData="M355,303h55c-18,0 -28,7 -28,14 0,8 11,13 31,14l25,2c35,3 54,16 54,41 0,28 -25,47 -62,47h-84v-34h77c14,0 22,-5 22,-12 0,-6 -8,-10 -24,-11l-26,-2c-34,-3 -52,-17 -52,-44 0,-10 4,-20 12,-28z" />
    <path android:fillColor="#090909" android:pathData="M332,184m-26,0a26,26 0,1 0,52,0a26,26 0,1 0,-52,0" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#090909" android:strokeWidth="22" android:strokeLineCap="round" android:pathData="M332,169c49,0 88,39 88,88" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#090909" android:strokeWidth="22" android:strokeLineCap="round" android:pathData="M332,124c74,0 133,59 133,133" />
</vector>`;

const legacy = String.raw`<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="512" android:viewportHeight="512">
    <path android:fillColor="#dc2337" android:pathData="M96,0H416A96,96 0,0 1,512 96V416A96,96 0,0 1,416 512H96A96,96 0,0 1,0 416V96A96,96 0,0 1,96 0Z" />
    <path android:fillColor="#090909" android:pathData="M70,176h112c39,0 67,22 67,56 0,26 -16,45 -42,52l52,61h-53l-44,-54h-33l-32,54H56l49,-84 42,-22h35c13,0 23,-5 23,-12s-10,-11 -24,-11H98z" />
    <path android:fillColor="#090909" android:pathData="M250,303h55c-18,0 -28,7 -28,14 0,8 11,13 31,14l25,2c35,3 54,16 54,41 0,28 -25,47 -62,47h-84v-34h77c14,0 22,-5 22,-12 0,-6 -8,-10 -24,-11l-26,-2c-34,-3 -52,-17 -52,-44 0,-10 4,-20 12,-28z" />
    <path android:fillColor="#090909" android:pathData="M355,303h55c-18,0 -28,7 -28,14 0,8 11,13 31,14l25,2c35,3 54,16 54,41 0,28 -25,47 -62,47h-84v-34h77c14,0 22,-5 22,-12 0,-6 -8,-10 -24,-11l-26,-2c-34,-3 -52,-17 -52,-44 0,-10 4,-20 12,-28z" />
    <path android:fillColor="#090909" android:pathData="M332,184m-26,0a26,26 0,1 0,52,0a26,26 0,1 0,-52,0" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#090909" android:strokeWidth="22" android:strokeLineCap="round" android:pathData="M332,169c49,0 88,39 88,88" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#090909" android:strokeWidth="22" android:strokeLineCap="round" android:pathData="M332,124c74,0 133,59 133,133" />
</vector>`;

fs.writeFileSync(path.join(res, 'drawable', 'rss_icon_foreground.xml'), foreground);
fs.writeFileSync(path.join(res, 'mipmap-anydpi-v21', 'ic_launcher.xml'), legacy);
fs.writeFileSync(path.join(res, 'values', 'rss_icon_colors.xml'), String.raw`<?xml version="1.0" encoding="utf-8"?>
<resources><color name="rss_icon_bg">#dc2337</color></resources>`);
const adaptive = String.raw`<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/rss_icon_bg" />
    <foreground android:drawable="@drawable/rss_icon_foreground" />
</adaptive-icon>`;
fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive);
fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive);
fs.writeFileSync(path.join(res, 'mipmap-anydpi-v21', 'ic_launcher_round.xml'), legacy);
console.log('[patch-icon] Android launcher icon patched');
