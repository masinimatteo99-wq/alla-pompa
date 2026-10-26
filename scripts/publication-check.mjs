import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Elenco esplicito: nuovi file e formati richiedono una revisione prima dell'inclusione.
const root = fileURLToPath(new URL('../', import.meta.url));
const files = [
  '.gitignore', '.github/workflows/pages.yml', 'README.md',
  'demo-50-rifornimenti.json', 'index.html', 'package.json', 'package-lock.json',
  'tsconfig.json', 'vite.config.ts', 'playwright.config.ts',
];
const errors = [];
const extensions = new Set(['.ts', '.css', '.mjs']);

function collect(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.name === '.DS_Store') continue;
    if (directory === 'scripts' && entry.name.endsWith('.command')) continue;
    if (entry.isDirectory()) collect(name);
    else if (entry.isFile() && extensions.has(extname(name))) files.push(name);
    else errors.push(`File non previsto nell'elenco pubblico: ${name}`);
  }
}
for (const directory of ['src', 'scripts', 'tests', 'e2e']) collect(directory);

// public/ viene copiato integralmente da Vite: deve essere vuoto finché non revisionato.
if (existsSync(resolve(root, 'public')) && readdirSync(resolve(root, 'public')).some((name) => name !== '.DS_Store')) {
  errors.push('public/ contiene file da revisionare prima della build.');
}

const checks = [
  ['percorso personale', /\/(?:Users|home)\/[^\s/'"`]+/i],
  ['indirizzo di rete privata', /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/],
  ['indirizzo email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['credenziale GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['chiave privata', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['credenziali in URL', /https?:\/\/[^\s/"']+:[^\s/"']+@/i],
];
for (const name of files) {
  const path = resolve(root, name);
  if (!lstatSync(path).isFile()) {
    errors.push(`Non è un file regolare: ${name}`);
    continue;
  }
  const content = readFileSync(path, 'utf8');
  for (const [label, expression] of checks) {
    // Contatto upstream di glob incluso nei metadati del lockfile.
    const inspected = name === 'package-lock.json' && label === 'indirizzo email'
      ? content.replaceAll('i' + '@izs.me', 'UPSTREAM_CONTACT') : content;
    if (expression.test(inspected)) errors.push(`${name}: possibile ${label}`);
  }
}

// Quando esiste un repository, impedisce che file estranei all'elenco siano tracciati.
const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
if (tracked.status === 0) {
  const allowed = new Set(files);
  for (const name of tracked.stdout.split('\0').filter(Boolean)) {
    if (!allowed.has(name)) errors.push(`File Git non revisionato: ${name}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Verificati ${files.length} file pubblicabili: nessuna corrispondenza nei controlli automatici.`);
  if (process.argv.includes('--list')) console.log(files.sort().map((name) => relative(root, resolve(root, name))).join('\n'));
}
