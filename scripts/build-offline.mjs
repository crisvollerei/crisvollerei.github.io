import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output = path.join(root,'qingzheng-offline.html');
const mime = {'.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2'};
const hash = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

function assetPath(url, directory = root) {
  const file = path.resolve(directory,url.split(/[?#]/)[0]);
  const relative = path.relative(path.join(root,'assets'),file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Asset outside assets/: ${url}`);
  return file;
}
function embedAsset(url, directory) {
  if (url.startsWith('#') || url.startsWith('data:')) return url;
  if (/^[a-z]+:/i.test(url) || url.startsWith('//')) throw new Error(`External offline asset: ${url}`);
  const file = assetPath(url,directory), type = mime[path.extname(file)];
  if (!type) throw new Error(`Unsupported offline asset: ${url}`);
  return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
}

export function buildOffline() {
  const modules = new Set(), visiting = new Set(), bundled = [];
  const moduleId = file => `qingzheng/${path.relative(path.join(root,'assets'),file).split(path.sep).join('/')}`;
  function bundleModule(file) {
    const id = moduleId(file);
    if (modules.has(id)) return id;
    if (visiting.has(id)) throw new Error(`Circular offline module dependency: ${id}`);
    visiting.add(id);
    const exports = [];
    // This project uses only static default/named imports and const/function exports.
    // Fail on other module syntax rather than pretending to be a general JS bundler.
    let source = fs.readFileSync(file,'utf8').replace(/^import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
      (match,binding,url) => {
        const dependency = bundleModule(assetPath(url,path.dirname(file)));
        if (/^\{[\w\s,]+\}$/.test(binding)) {
          return `const ${binding.replace(/\b(\w+)\s+as\s+(\w+)\b/g,'$1: $2')} = __modules[${JSON.stringify(dependency)}];`;
        }
        if (/^\w+$/.test(binding)) return `const ${binding} = __modules[${JSON.stringify(dependency)}].default;`;
        throw new Error(`Unsupported offline import binding: ${binding}`);
      });
    source = source.replace(/^export default /gm,() => {
      exports.push('default: __offlineDefault'); return 'const __offlineDefault = ';
    }).replace(/^export (const|function) (\w+)/gm,(match,type,name) => {
      exports.push(name); return `${type} ${name}`;
    });
    if (/^\s*(?:import|export)\b/m.test(source) || /\bimport\s*[.(]/.test(source)) {
      throw new Error(`Unsupported offline module syntax: ${id}`);
    }
    bundled.push(`__modules[${JSON.stringify(id)}] = (() => {\n${source}\nreturn { ${exports.join(', ')} };\n})();`);
    visiting.delete(id); modules.add(id);
    return id;
  }
  let html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  const styles = [], scripts = [];
  html = html.replace(/[ \t]*<link rel="stylesheet" href="([^"]+)">/g,(tag,url) => {
    const file = assetPath(url);
    styles.push(fs.readFileSync(file,'utf8').replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,
      (match,quote,resource) => `url('${embedAsset(resource,path.dirname(file))}')`));
    return '';
  });
  const css = styles.join('\n');
  html = html.replace(/<script src="([^"]+)"><\/script>/g,(tag,url) => {
    const source = fs.readFileSync(assetPath(url),'utf8');
    scripts.push(source);
    return `<script>${source}</script>`;
  });
  html = html.replace(/<script type="module" src="([^"]+)"><\/script>/g,(tag,url) => {
    bundleModule(assetPath(url));
    const source = `(() => {\n'use strict';\nconst __modules = Object.create(null);\n${bundled.join('\n')}\n})();`;
    scripts.push(source);
    return `<style>${css}</style>\n<script>${source}</script>`;
  });
  html = html.replace(/((?:src|href|data-src)=")((?:assets\/)[^"]+)(")/g,
    (match,prefix,url,suffix) => prefix+embedAsset(url,root)+suffix);
  html = html.replace('<a class="brand" href="./"','<a class="brand" href="#calendarSection"');
  html = html.replace('</title>','（离线版）</title>');
  // The classic bundle must run after the body, without relying on module deferral.
  const bundleTag = html.match(/<script>\(\(\) => \{\n'use strict';[\s\S]*?<\/script>/)[0];
  html = html.replace(bundleTag,'').replace('</body>',`${bundleTag}\n</body>`);
  const policy = `default-src 'none'; script-src ${scripts.map(hash).join(' ')}; style-src ${hash(css)}; img-src data: 'self'; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  html = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]+(">)/,`$1${policy}$2`);
  return html;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const html = buildOffline();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(output) || fs.readFileSync(output,'utf8') !== html) {
      console.error('Offline HTML is stale. Run npm run build:offline.');
      process.exitCode = 1;
    } else console.log('Offline HTML is current.');
  } else {
    fs.writeFileSync(output,html);
    console.log(`Built qingzheng-offline.html (${Buffer.byteLength(html)} bytes).`);
  }
}
