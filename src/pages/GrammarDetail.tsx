import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Ruby } from '../components/Ruby';
import { db } from '../db/db';
import { usePack, useSettings } from '../hooks';
import { plainText } from '../reading/furigana';
import { speak } from '../speech/tts';
import { cardId } from '../srs/scheduler';
import { cardStatus, type CardStatus } from '../stats/stats';

const STATUS_LABEL: Record<CardStatus, string> = {
  unseen: 'Not studied yet',
  learning: 'Learning',
  young: 'Young',
  mature: 'Mature',
};

export function GrammarDetail() {
  const { id = '' } = useParams();
  const pack = usePack();
  const settings = useSettings();
  const point = pack.grammarById.get(id);
  const card = useLiveQuery(() => db.cards.get(cardId(pack.manifest.id, 'grammar', 'recognition', id)), [pack, id]);

  if (!point) {
    return (
      <div className="empty">
        <span className="jp">？</span>
        Grammar point not found.
        <div>
          <Link to="/library?tab=grammar">Back to the library</Link>
        </div>
      </div>
    );
  }

  const say = (text: string) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });
  const level = pack.manifest.levels.find((l) => l.id === point.level)?.label;
  const status = cardStatus(card);
  const furigana = settings.furigana === 'none' ? 'none' : 'all';

  return (
    <div className="stack">
      <div className="topbar">
        <Link to="/library?tab=grammar" className="icon-btn" aria-label="Back to the library">
          <Icon name="back" />
        </Link>
        <span className="badge">{level} · Grammar</span>
        <span className="row" style={{ gap: 6 }}>
          <span className={`dot ${status}`} />
          <span className="faint">{STATUS_LABEL[status]}</span>
        </span>
      </div>

      <div className="card hero">
        <div className="grammar-pattern" lang="ja" style={{ textAlign: 'left' }}>
          {point.pattern}
        </div>
        <div className="meaning" style={{ maxWidth: 'none' }}>
          {point.meaning}
        </div>
      </div>

      {point.formation.length > 0 && (
        <>
          <div className="section-title">Formation · 作り方</div>
          <ul className="card formation" lang="ja">
            {point.formation.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}

      {point.notes && (
        <>
          <div className="section-title">Notes</div>
          <div className="card muted" style={{ lineHeight: 1.6 }}>
            {point.notes}
          </div>
        </>
      )}

      <div className="section-title">Examples · 例文</div>
      <div className="stack" style={{ gap: 8 }}>
        {point.examples.map((ex) => (
          <div key={ex.r} className="card example">
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <p className="sentence small" lang="ja">
                <Ruby markup={ex.r} cloze={ex.c} mode={furigana} />
              </p>
              <button className="icon-btn" onClick={() => void say(plainText(ex.r))} aria-label="Play audio">
                <Icon name="speaker" />
              </button>
            </div>
            <div className="muted">{ex.e}</div>
            {ex.i && (
              <a className="faint" href={`https://tatoeba.org/en/sentences/show/${ex.i}`} target="_blank" rel="noreferrer">
                Tatoeba #{ex.i}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
