import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { loadSpeaking } from '../content/packs';
import type { SpeakingPack } from '../content/types';
import { usePack, useSettings } from '../hooks';

/**
 * Speaking practice (話す): the part of learning a language that reading and flashcards don't
 * train. Role-plays with Lucas and Hana, shadowing, and quick responses against the clock, so
 * that answering becomes automatic instead of something you translate in your head.
 */
export function Speak() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const [content, setContent] = useState<SpeakingPack | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    loadSpeaking(pack.manifest.id).then(setContent, () => setError(true));
  }, [pack]);

  const conversations = content?.dialogues.filter((d) => d.roles.length > 1) ?? [];
  const levels = [...new Set(conversations.map((d) => d.level))].sort((a, b) => b - a);

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Back">
          <Icon name="back" />
        </button>
        <h2 className="wordle-title">
          Speak <span className="jp faint">話す</span>
        </h2>
      </div>
      <p className="faint" style={{ margin: 0 }}>
        Out loud, every time. Freezing goes away with practice saying things, not with knowing more words.
      </p>

      {error && <div className="notice error">Could not load the speaking practice. Open the app once while online.</div>}

      <div className="grid-2">
        <Link to="/speak/responses" className="card link">
          <div className="jp" style={{ fontSize: '1.6rem', color: 'var(--accent)' }}>
            即
          </div>
          <strong>Quick replies</strong>
          <div className="faint">Hear it, answer in 5 seconds</div>
        </Link>
        <Link to="/speak/shadow" className="card link">
          <div className="jp" style={{ fontSize: '1.6rem', color: 'var(--accent)' }}>
            影
          </div>
          <strong>Shadowing</strong>
          <div className="faint">Repeat along with the voice</div>
        </Link>
      </div>

      <div className="section-title">Role-play · ロールプレイ</div>
      <p className="faint" style={{ margin: 0 }}>
        Pick a scene and a part. The app plays the other person; you say your lines.
      </p>
      {levels.map((level) => (
        <div key={level} className="stack" style={{ gap: 8 }}>
          <div className="faint">
            N{level}
            {settings.levels.includes(level) ? '' : ' · not in your levels'}
          </div>
          <div className="list">
            {conversations
              .filter((d) => d.level === level)
              .map((d) => (
                <Link key={d.id} to={`/speak/roleplay/${d.id}`} className="list-item">
                  <span className="term" lang="ja">
                    {d.title}
                  </span>
                  <span className="gloss">{d.titleEn}</span>
                </Link>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
