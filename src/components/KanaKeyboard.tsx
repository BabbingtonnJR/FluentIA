/**
 * Kana chart, column by column (あいうえお down each column), as on a gojūon table. The gaps in
 * the や and わ columns hold phone-keyboard modifiers for the last kana: 小 (small), ゛ and ゜.
 */
const COLUMNS = ['あいうえお', 'かきくけこ', 'さしすせそ', 'たちつてと', 'なにぬねの', 'はひふへほ', 'まみむめも', 'や小ゆーよ', 'らりるれろ', 'わ゛を゜ん'];

export type Modifier = '小' | '゛' | '゜';
const MODIFIER_LABEL: Record<Modifier, string> = { 小: 'Small kana', '゛': 'Add dakuten', '゜': 'Add handakuten' };
const isModifier = (k: string): k is Modifier => k in MODIFIER_LABEL;

interface Props {
  /** Class per kana, e.g. Wordle's hit / near / miss. */
  marks?: ReadonlyMap<string, string>;
  onKana: (kana: string) => void;
  onModifier: (mod: Modifier) => void;
  onBackspace: () => void;
  onEnter?: () => void;
  enterLabel?: string;
}

export function KanaKeyboard({ marks, onKana, onModifier, onBackspace, onEnter, enterLabel = 'Enter' }: Props) {
  return (
    <div className="kana-keys" lang="ja">
      <div className="kana-block">
        {COLUMNS.flatMap((col, ci) =>
          [...col].map((k, ri) => (
            <button
              key={k}
              type="button"
              className={`kana-key ${isModifier(k) ? 'mod' : (marks?.get(k) ?? '')}`}
              style={{ gridColumn: ci + 1, gridRow: ri + 1 }}
              onClick={() => (isModifier(k) ? onModifier(k) : onKana(k))}
              aria-label={isModifier(k) ? MODIFIER_LABEL[k] : undefined}
            >
              {k}
            </button>
          )),
        )}
      </div>
      <div className={`kana-actions${onEnter ? '' : ' single'}`}>
        <button type="button" className="btn" onClick={onBackspace} aria-label="Delete">
          ⌫
        </button>
        {onEnter && (
          <button type="button" className="btn primary" onClick={onEnter}>
            {enterLabel}
          </button>
        )}
      </div>
    </div>
  );
}
