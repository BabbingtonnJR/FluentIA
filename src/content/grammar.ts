// Grammar points often have several forms that fit the same sentence (じゃないです / じゃありません /
// ではありません), and some points mean the same in most sentences (から / ので). These helpers
// list the other right answers, and keep them out of the wrong options of every exercise.
import type { GrammarPoint } from './types';

/**
 * A form in `variants`, with the characters it can't follow after "|!": "ずに|!し" since
 * し + ないで becomes せずに, not しずに.
 */
function parseForm(f: string): { text: string; notAfter: string } {
  const [text, notAfter = ''] = f.split('|!');
  return { text, notAfter };
}

/** The other forms of a point that fit where `form` fits, after the text `before`. */
export function alternativeForms(g: GrammarPoint, form: string, before = ''): string[] {
  const last = before.at(-1) ?? '';
  for (const set of g.variants ?? []) {
    const forms = set.map(parseForm);
    if (!forms.some((f) => f.text === form)) continue;
    return forms.filter((f) => f.text !== form && !(last && f.notAfter.includes(last))).map((f) => f.text);
  }
  return [];
}

/** Every form a point lists as interchangeable, for wrong-option filtering. */
export function allForms(g: GrammarPoint): Set<string> {
  return new Set((g.variants ?? []).flat().map((f) => parseForm(f).text));
}

/** Whether `p` can give wrong options for a blank that `g` fills: not `g`, nor a point that means the same. */
export function canBeRival(g: GrammarPoint, p: GrammarPoint): boolean {
  return p.id !== g.id && !g.alike?.includes(p.id) && !p.alike?.includes(g.id);
}
