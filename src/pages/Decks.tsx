import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router';
import { noteCardId } from '../anki/convert';
import { deleteDeck, setDeckNewPerDay } from '../anki/store';
import { Icon } from '../components/Icon';
import { db } from '../db/db';
import { usePack } from '../hooks';
import { State } from '../srs/scheduler';

const NEW_PER_DAY = [0, 5, 10, 20, 30];

/** The learner's own decks (imported from Anki): how far along each is, and its daily new cards. */
export function Decks() {
  const pack = usePack();
  const navigate = useNavigate();
  const lang = pack.manifest.id;
  const decks = useLiveQuery(async () => {
    const all = (await db.decks.where('lang').equals(lang).toArray()).filter((d) => !d.deleted).sort((a, b) => a.name.localeCompare(b.name));
    const now = Date.now();
    return Promise.all(
      all.map(async (deck) => {
        const notes = (await db.notes.where('deckId').equals(deck.id).toArray()).filter((n) => !n.deleted);
        const cards = (await db.cards.bulkGet(notes.map((n) => noteCardId(lang, n.id)))).filter((c) => c && !c.deleted);
        return {
          deck,
          total: notes.length,
          studied: cards.filter((c) => c!.state !== State.New).length,
          due: cards.filter((c) => c!.due <= now).length,
        };
      }),
    );
  }, [lang]);

  async function remove(id: string, name: string) {
    if (!confirm(`Remove “${name}” and its progress? Words linked to Fluentia's own cards stay.`)) return;
    await deleteDeck(id);
  }

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/settings')} aria-label="Back">
          <Icon name="close" />
        </button>
        <h2 className="wordle-title">Your decks</h2>
      </div>
      <p className="faint" style={{ margin: 0 }}>
        Cards from Anki that are not in Fluentia's word list. They come up in your daily study with the rest, a few new ones each day.
      </p>

      <Link to="/decks/import" className="btn primary block">
        Import from Anki
      </Link>

      {decks?.length === 0 && <div className="empty">No decks yet.</div>}
      {decks?.map(({ deck, total, studied, due }) => (
        <div key={deck.id} className="card stack">
          <div className="spread">
            <strong>{deck.name}</strong>
            <button className="icon-btn" onClick={() => void remove(deck.id, deck.name)} aria-label={`Remove ${deck.name}`}>
              <Icon name="close" />
            </button>
          </div>
          <div className="faint">
            {total} cards · {studied} studied · {due} due now
          </div>
          <div className="field">
            <span className="label">New cards per day</span>
            <div className="segmented" role="group">
              {NEW_PER_DAY.map((n) => (
                <button key={n} className={deck.newPerDay === n ? 'on' : ''} onClick={() => void setDeckNewPerDay(deck.id, n)}>
                  {n === 0 ? 'Off' : n}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
