import { mkdir, copyFile, rm, cp } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'mobile-web');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const name of ['index.html', 'styles.css', 'app.js', 'manifest.json', 'sw.js']) {
  await copyFile(path.join(root, name), path.join(out, name));
}
await cp(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
console.log('Prepared mobile web bundle:', out);
