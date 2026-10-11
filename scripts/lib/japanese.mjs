// Node-side helpers for the content build scripts: the kuromoji tokenizer and the grammar sources.
// The text analysis itself is in shared/japanese/core.mjs, which the app uses too.
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import kuromoji from 'kuromoji';

export async function createTokenizer() {
  const require = createRequire(import.meta.url);
  const dicPath = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
  return new Promise((resolve, reject) => kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t))));
}

export * from '../../shared/japanese/core.mjs';

// --- Grammar ---------------------------------------------------------------------

/** Grammar point source files, easiest level first, then file order (teaching order). */
export async function grammarFiles(srcDir) {
  return (await readdir(srcDir)).filter((f) => /^n\d[a-z]?\.json$/.test(f)).sort((a, b) => Number(b[1]) - Number(a[1]) || a.localeCompare(b));
}

/** The grammar points that have a `match` regex, as { id, re }, with ids as in grammar.json. */
export async function grammarMatchers(srcDir) {
  const out = [];
  for (const f of await grammarFiles(srcDir)) {
    const level = Number(f[1]);
    for (const p of JSON.parse(await readFile(path.join(srcDir, f), 'utf8'))) {
      if (p.match) out.push({ id: `n${level}-${p.id}`, re: new RegExp(p.match, 'u') });
    }
  }
  return out;
}
