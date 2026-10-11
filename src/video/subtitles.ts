/** One subtitle line, with times in seconds. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

/**
 * Subtitle files come in UTF-8, UTF-16 (with a byte-order mark) or, for older Japanese files,
 * Shift_JIS. Try them in that order.
 */
export function decodeSubtitles(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/** "00:01:02,345", "01:02.345" or ASS's "0:01:02.34" → seconds. */
function time(t: string): number {
  const parts = t.trim().replace(',', '.').split(':').map(Number);
  return parts.reduce((s, p) => s * 60 + p, 0);
}

/** Markup that is not text: HTML-ish tags (<i>), ASS override blocks ({\an8}) and ASS line breaks. */
function clean(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

function parseAss(text: string): Cue[] {
  const out: Cue[] = [];
  let format: string[] = [];
  let inEvents = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\[.*\]$/.test(line.trim())) {
      inEvents = /events/i.test(line);
      continue;
    }
    if (!inEvents) continue;
    if (line.startsWith('Format:')) format = line.slice(7).split(',').map((f) => f.trim().toLowerCase());
    if (!line.startsWith('Dialogue:') || !format.length) continue;
    // The text field is last and may itself contain commas.
    const fields = line.slice(9).split(',');
    const value = (name: string) => fields[format.indexOf(name)]?.trim() ?? '';
    const textValue = fields.slice(format.length - 1).join(',');
    out.push({ start: time(value('start')), end: time(value('end')), text: clean(textValue) });
  }
  return out;
}

/** SRT and WebVTT: blocks separated by blank lines, each with a "start --> end" line. */
function parseSrt(text: string): Cue[] {
  const out: Cue[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at].split('-->');
    out.push({ start: time(a), end: time(b.trim().split(/\s+/)[0]), text: clean(lines.slice(at + 1).join('\n')) });
  }
  return out;
}

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/**
 * Lines from a subtitle file (.srt, .vtt, .ass, .ssa), in time order. Lines with no Japanese
 * (signs, karaoke timing, music notes) are dropped, and repeats of the same line merged.
 */
export function parseSubtitles(text: string, fileName = ''): Cue[] {
  const isAss = /\.(ass|ssa)$/i.test(fileName) || /^\[Script Info\]/m.test(text);
  const cues = (isAss ? parseAss(text) : parseSrt(text)).filter((c) => c.text && JAPANESE.test(c.text) && c.end > c.start);
  cues.sort((a, b) => a.start - b.start);
  const out: Cue[] = [];
  for (const c of cues) {
    const prev = out.at(-1);
    if (prev && prev.text === c.text && c.start - prev.end < 0.5) prev.end = Math.max(prev.end, c.end);
    else out.push({ ...c });
  }
  return out;
}
