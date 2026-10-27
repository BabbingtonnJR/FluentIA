import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../components/Icon';
import { StrokeOrder } from '../components/StrokeOrder';
import { Examples, KanjiReadings } from '../components/WordSenses';
import { cardFace } from '../content/faces';
import { formatKun, vocabWithKanji } from '../content/packs';
import { db } from '../db/db';
import { markItemKnown } from '../db/repo';
import { usePack, useSettings } from '../hooks';
import { speak } from '../speech/tts';
import { cardId } from '../srs/scheduler';
import { cardStatus } from '../stats/stats';

export function KanjiDetail() {
  const { char = '' } = useParams();
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const [run, setRun] = useState(0);
  const k = pack.kanjiById.get(char);
  const lang = pack.manifest.id;
  const card = useLiveQuery(() => db.cards.get(cardId(lang, 'kanji', 'recognition', char)), [lang, char]);

  if (!k) {
    return (
      <div className="empty">
        <span className="jp">？</span>
        This kanji is not in the current levels.
        <div>
          <Link to="/library">Back to Library</Link>
        </div>
      </div>
    );
  }

  const face = cardFace(pack, 'kanji', 'recognition', char);
  // Words already shown under a reading aren't listed again.
  const shownWords = new Set(face?.kanjiReadings?.flatMap((r) => r.words.map((w) => w.word)) ?? []);
  const words = vocabWithKanji(pack, char).filter((v) => !shownWords.has(v.word));
  const say = (text: string) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });
  const status = cardStatus(card);

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <Icon name="back" />
        </button>
        <strong style={{ flex: 1 }}>{k.meanings.slice(0, 3).join(', ')}</strong>
        <span className="badge">N{k.level}</span>
      </div>

      <StrokeOrder lang={lang} char={char} run={run} />
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn small" onClick={() => setRun((r) => r + 1)}>
          <Icon name="replay" /> Replay · {k.strokes} {k.strokes === 1 ? 'stroke' : 'strokes'}
        </button>
      </div>

      <div className="card stack" style={{ gap: 10 }}>
        <div>{k.meanings.join(', ')}</div>
        {face?.kanjiReadings?.length ? (
          <KanjiReadings face={face} say={(t) => void say(t)} />
        ) : (
          <div className="jp" lang="ja" style={{ fontSize: '1.2rem' }}>
            {[...k.on, ...k.kun.map(formatKun)].join('、')}
          </div>
        )}
        {face?.examples && <Examples examples={face.examples} mode={settings.furigana === 'none' ? 'none' : 'all'} say={(t) => void say(t)} />}
        <div className="spread">
          <span className="faint">{status === 'unseen' ? 'Not studied yet' : `Status: ${status}`}</span>
          {status === 'unseen' && (
            <button className="btn small" onClick={() => void markItemKnown({ lang, kind: 'kanji', direction: 'recognition', itemId: char, level: k.level })}>
              I know this
            </button>
          )}
        </div>
      </div>

      {words.length > 0 && (
        <details className="more-words">
          <summary className="section-title">More words with {char} · {words.length}</summary>
          <div className="list">
            {words.map((v) => (
              <button key={v.id} className="list-item" onClick={() => void say(v.reading)}>
                <span className="term" lang="ja">
                  {v.word}
                </span>
                <span className="gloss">
                  <span className="jp" lang="ja">
                    {v.reading}
                  </span>{' '}
                  · {v.meaning}
                </span>
                <span className="badge">N{v.level}</span>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
