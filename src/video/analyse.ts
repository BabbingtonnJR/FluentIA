import { analyse, vocabLookup, type GrammarMatcher, type Tokenizer } from '../../shared/japanese/core.mjs';
import type { LitSentence, Pack } from '../content/types';
import type { Cue } from './subtitles';

/** A subtitle line with its breakdown, as stored for an imported video. */
export interface VideoLine {
  start: number;
  end: number;
  s: LitSentence;
}

interface KuromojiModule {
  builder(options: { dicPath: string }): { build(callback: (err: Error | null, tokenizer: Tokenizer) => void): void };
}

let tokenizer: Promise<Tokenizer> | null = null;

/**
 * A dictionary file as gzip bytes, which is what kuromoji expects. Some servers send .gz files with
 * Content-Encoding: gzip, so the browser has already unpacked them; pack those again.
 */
async function gzipBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return bytes.buffer;
  return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

/** Just enough of XMLHttpRequest for kuromoji's dictionary loader, backed by gzipBytes(). */
class DictionaryRequest {
  responseType = '';
  status = 0;
  statusText = '';
  response: ArrayBuffer | null = null;
  onload: ((this: DictionaryRequest) => void) | null = null;
  onerror: ((this: DictionaryRequest, err: unknown) => void) | null = null;
  private url = '';
  open(_method: string, url: string) {
    this.url = url;
  }
  send() {
    gzipBytes(this.url).then(
      (buf) => {
        this.status = 200;
        this.response = buf;
        this.onload?.call(this);
      },
      (err: unknown) => {
        this.statusText = String(err);
        this.onerror?.call(this, err);
      },
    );
  }
}

/**
 * kuromoji with its dictionary (~17 MB, cached after the first time). The prebuilt browser bundle is
 * loaded on demand so the app itself stays small.
 */
export function loadTokenizer(): Promise<Tokenizer> {
  if (!tokenizer) {
    tokenizer = import('kuromoji/build/kuromoji.js').then(
      (mod: { default?: KuromojiModule }) =>
        new Promise<Tokenizer>((resolve, reject) => {
          const kuromoji = mod.default ?? (mod as unknown as KuromojiModule);
          // kuromoji fetches the dictionary with XMLHttpRequest; swap in DictionaryRequest while it loads.
          const original = window.XMLHttpRequest;
          window.XMLHttpRequest = DictionaryRequest as unknown as typeof XMLHttpRequest;
          try {
            kuromoji.builder({ dicPath: '/kuromoji/' }).build((err, t) => {
              window.XMLHttpRequest = original;
              if (err) reject(err);
              else resolve(t);
            });
          } catch (err) {
            window.XMLHttpRequest = original;
            reject(err);
          }
        }),
    );
    tokenizer.catch(() => {
      tokenizer = null;
    });
  }
  return tokenizer;
}

/** Breaks down each subtitle line, yielding to the page now and then so progress can show. */
export async function analyseCues(cues: Cue[], pack: Pack, onProgress?: (done: number) => void): Promise<VideoLine[]> {
  const t = await loadTokenizer();
  const lookup = vocabLookup(pack.vocab);
  const matchers: GrammarMatcher[] = pack.grammar.flatMap((g) => (g.match ? [{ id: g.id, re: new RegExp(g.match, 'u') }] : []));
  const out: VideoLine[] = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    // Line breaks in a subtitle are layout only; the words run on.
    out.push({ start: c.start, end: c.end, s: analyse(c.text.replace(/\n/g, ''), t, lookup, matchers) });
    if (i % 40 === 39) {
      onProgress?.(i + 1);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(cues.length);
  return out;
}
