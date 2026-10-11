import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { readApkg, type AnkiCollection } from '../anki/apkg';
import { cleanField, guessRoles, planImport, type ImportPlan, type Roles } from '../anki/convert';
import { applyImport } from '../anki/store';
import { Icon } from '../components/Icon';
import { usePack } from '../hooks';

/**
 * Imports an Anki deck (.apkg). Words and kanji the app already has become its own cards
 * (with audio, stroke order and examples) and keep their Anki progress; everything else
 * becomes a deck of the learner's own cards.
 */
export function AnkiImport() {
  const pack = usePack();
  const navigate = useNavigate();
  const [col, setCol] = useState<AnkiCollection | null>(null);
  const [fileName, setFileName] = useState('');
  const [deckIds, setDeckIds] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<Map<string, Roles>>(new Map());
  const [useBuiltIn, setUseBuiltIn] = useState(true);
  const [withProgress, setWithProgress] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ plan: ImportPlan; cards: number } | null>(null);

  async function open(file: File) {
    setError(null);
    setDone(null);
    setBusy('Reading the deck…');
    try {
      const c = await readApkg(await file.arrayBuffer());
      if (!c.notes.length) throw new Error('This deck has no cards.');
      const guessed = new Map<string, Roles>();
      for (const t of c.noteTypes.values()) {
        const samples = c.notes.filter((n) => n.typeId === t.id).slice(0, 5);
        if (samples.length) guessed.set(t.id, guessRoles(t, samples.map((n) => n.fields)));
      }
      setCol(c);
      setFileName(file.name);
      setDeckIds(new Set(c.cards.map((card) => card.deckId)));
      setRoles(guessed);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(/not a zip/i.test(message) ? 'This is not an Anki deck package (.apkg).' : message);
    } finally {
      setBusy(null);
    }
  }

  /** Notes per deck, by each note's first card. */
  const deckCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!col) return counts;
    const seen = new Set<string>();
    for (const card of [...col.cards].sort((a, b) => a.ord - b.ord)) {
      if (seen.has(card.noteId)) continue;
      seen.add(card.noteId);
      counts.set(card.deckId, (counts.get(card.deckId) ?? 0) + 1);
    }
    return counts;
  }, [col]);

  const plan = useMemo(
    () => (col ? planImport(col, pack, { lang: pack.manifest.id, deckIds, roles, useBuiltIn, withProgress, now: Date.now() }) : null),
    [col, pack, deckIds, roles, useBuiltIn, withProgress],
  );

  async function save() {
    if (!plan) return;
    setBusy('Saving…');
    try {
      const { cards } = await applyImport(plan);
      setDone({ plan, cards });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const setRole = (typeId: string, patch: Partial<Roles>) => setRoles((m) => new Map(m).set(typeId, { ...m.get(typeId)!, ...patch }));
  const toggleDeck = (id: string) =>
    setDeckIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/decks')} aria-label="Back">
          <Icon name="close" />
        </button>
        <h2 className="wordle-title">Import from Anki</h2>
      </div>

      {done ? (
        <div className="card stack">
          <strong>Imported</strong>
          <p className="faint" style={{ margin: 0 }}>
            {done.plan.custom} cards in your own deck{done.plan.decks.length === 1 ? '' : 's'} and {done.plan.matched} words and kanji linked to
            Fluentia's cards. Progress kept for {done.cards} cards. New cards show up in your daily study.
          </p>
          <Link to="/decks" className="btn primary block">
            See your decks
          </Link>
        </div>
      ) : (
        <>
          <div className="card stack" style={{ padding: '12px 14px', gap: 6 }}>
            <strong>Export from Anki</strong>
            <ol className="faint" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              <li>On a computer: File → Export → “Anki Deck Package (.apkg)”, with “Include scheduling information” on to bring your progress.</li>
              <li>On AnkiMobile: tap the deck's gear → Export. Shared decks from AnkiWeb are .apkg files too.</li>
            </ol>
          </div>

          <label className="field">
            <span>Anki deck (.apkg)</span>
            <input
              type="file"
              accept=".apkg,.colpkg"
              disabled={!!busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void open(f);
              }}
            />
          </label>
          {busy && <div className="faint">{busy}</div>}
          {error && <div className="notice error">{error}</div>}

          {col && plan && (
            <>
              <div className="section-title">Decks in {fileName}</div>
              <div className="card stack">
                {[...deckCounts]
                  .sort((a, b) => (col.decks.get(a[0]) ?? '').localeCompare(col.decks.get(b[0]) ?? ''))
                  .map(([id, n]) => (
                    <label key={id} className="switch-row">
                      <span>
                        <strong>{col.decks.get(id) ?? 'Deck'}</strong>
                        <div className="faint">{n} cards</div>
                      </span>
                      <input type="checkbox" checked={deckIds.has(id)} onChange={() => toggleDeck(id)} />
                    </label>
                  ))}
              </div>

              <div className="section-title">Fields</div>
              {[...roles].map(([typeId, r]) => {
                const type = col.noteTypes.get(typeId)!;
                const sample = col.notes.find((n) => n.typeId === typeId);
                const preview = (i: number | null) => (i == null || !sample ? '' : cleanField(sample.fields[i] ?? '').replace(/\n/g, ' · '));
                return (
                  <div key={typeId} className="card stack">
                    <strong>{type.name}</strong>
                    <label className="field">
                      <span>Front (the word or sentence)</span>
                      <select className="input" value={r.front} onChange={(e) => setRole(typeId, { front: Number(e.target.value) })}>
                        {type.fields.map((f, i) => (
                          <option key={f} value={i}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Reading (furigana)</span>
                      <select
                        className="input"
                        value={r.reading ?? ''}
                        onChange={(e) => setRole(typeId, { reading: e.target.value === '' ? null : Number(e.target.value) })}
                      >
                        <option value="">None</option>
                        {type.fields.map((f, i) => (
                          <option key={f} value={i}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="field">
                      <span className="label">Back (the answer)</span>
                      <div className="chips">
                        {type.fields.map((f, i) => {
                          const on = r.back.includes(i);
                          return (
                            <button
                              key={f}
                              className={`chip${on ? ' on' : ''}`}
                              aria-pressed={on}
                              onClick={() => setRole(typeId, { back: on ? r.back.filter((x) => x !== i) : [...r.back, i].sort((a, b) => a - b) })}
                            >
                              {f}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {sample && (
                      <div className="notice">
                        <div lang="ja">
                          <strong>{preview(r.front)}</strong> {r.reading != null && <span className="faint">{preview(r.reading)}</span>}
                        </div>
                        <div>{r.back.map(preview).filter(Boolean).join(' · ')}</div>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="card stack">
                <label className="switch-row">
                  <span>
                    <strong>Use Fluentia's cards for words it has</strong>
                    <div className="faint">With audio, kanji details and example sentences.</div>
                  </span>
                  <input type="checkbox" checked={useBuiltIn} onChange={(e) => setUseBuiltIn(e.target.checked)} />
                </label>
                <label className="switch-row">
                  <span>
                    <strong>Bring my Anki progress</strong>
                    <div className="faint">Cards you studied keep their due dates.</div>
                  </span>
                  <input type="checkbox" checked={withProgress} onChange={(e) => setWithProgress(e.target.checked)} />
                </label>
              </div>

              <div className="notice">
                {useBuiltIn && (
                  <div>
                    {plan.matched} words and kanji are in Fluentia
                    {withProgress && plan.matchedStudied > 0 && ` (${plan.matchedStudied} already studied: their progress comes along)`}.
                  </div>
                )}
                <div>
                  {plan.custom} cards become your own deck{plan.decks.length === 1 ? '' : 's'}
                  {plan.decks.length > 0 && `: ${plan.decks.map((d) => d.name).join(', ')}`}.
                </div>
                {plan.suspended > 0 && <div className="faint">{plan.suspended} suspended cards are left out.</div>}
                {plan.empty > 0 && <div className="faint">{plan.empty} cards with an empty front or back are left out.</div>}
              </div>

              <button className="btn primary block" disabled={!!busy || plan.custom + plan.matched === 0} onClick={() => void save()}>
                Import
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
