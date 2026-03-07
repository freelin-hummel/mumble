import { mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');

await mkdir(distDir, { recursive: true });
await cp(path.join(rootDir, 'index.html'), path.join(distDir, 'index.html'), { force: true });
await cp(path.join(rootDir, 'src'), path.join(distDir, 'src'), { recursive: true, force: true });

console.log(`Built web client assets into ${distDir}`);
