import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const check = process.argv.includes('--check'), hashes = new Map(), visiting = new Set();
const changed = [];
const references = /((?:from\s*|import\s*|url\(\s*)['"])(\.\.?\/)?([\w./-]+\.(?:js|css|svg|webp|png))(?:\?v=[\w-]+)?(['"])/g;

function update(file, content) {
  if (fs.readFileSync(file,'utf8') === content) return;
  changed.push(path.relative(root,file));
  if (!check) fs.writeFileSync(file,content);
}
function version(file) {
  if (hashes.has(file)) return hashes.get(file);
  if (visiting.has(file)) throw new Error(`Circular asset dependency: ${file}`);
  visiting.add(file);
  let bytes = fs.readFileSync(file);
  if (/\.(js|css)$/.test(file)) {
    const content = bytes.toString('utf8').replace(references,(match,prefix,dot = '',relative,suffix) => {
      const dependency = path.resolve(path.dirname(file),dot+relative);
      return `${prefix}${dot}${relative}?v=${version(dependency)}${suffix}`;
    });
    update(file,content);
    bytes = Buffer.from(content);
  }
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0,12);
  hashes.set(file,hash); visiting.delete(file);
  return hash;
}
for (const file of fs.readdirSync(path.join(root,'assets'))) {
  if (/\.(js|css)$/.test(file)) version(path.join(root,'assets',file));
}
const index = path.join(root,'index.html');
update(index,fs.readFileSync(index,'utf8').replace(/((?:href|src|data-src)=["'])(assets\/[\w.-]+)(?:\?v=[\w-]+)?(["'])/g,
  (match,prefix,relative,suffix) => `${prefix}${relative}?v=${version(path.join(root,relative))}${suffix}`));
if (check && changed.length) {
  console.error(`Stale asset versions: ${changed.join(', ')}. Run npm run version:assets.`);
  process.exitCode = 1;
} else console.log(check ? 'Asset versions are current.' : `Versioned ${changed.length} files.`);
