// Types for core.mjs, which is plain JavaScript so the Node build scripts can run it directly.
import type { LitSentence, VocabItem } from '../../src/content/types';

/** A kuromoji (IPADIC) token, as far as the analysis uses it. */
export interface Token {
  surface_form: string;
  basic_form: string;
  reading?: string;
  pos: string;
  pos_detail_1: string;
  conjugated_form: string;
}

export interface Tokenizer {
  tokenize(text: string): Token[];
}

export interface GrammarMatcher {
  id: string;
  re: RegExp;
}

export function toHiragana(s: string): string;
export function hasKanji(s: string): boolean;
export function plainText(markup: string): string;
export function tokenRuby(surface: string, readingKatakana: string | undefined): string;
export function vocabLookup(vocab: VocabItem[]): (token: Token) => number | undefined;
export function isFunctionToken(t: Token): boolean;
export function grammarSpan(re: RegExp, plain: string, bounds: Set<number>): [number, number] | null;
export function splitRuby(marked: string): { plain: string; spans: { start: number; end: number; reading: string }[] };
export function analyse(marked: string, tokenizer: Tokenizer, lookup: (token: Token) => number | undefined, matchers: GrammarMatcher[]): LitSentence;
