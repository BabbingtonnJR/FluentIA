import type { CSSProperties } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router';
import { PackContext, SettingsContext, useLiveSettings, useLoadedPack, useTheme } from './hooks';
import { Today } from './pages/Today';
import { Study } from './pages/Study';
import { Listen } from './pages/Listen';
import { Quiz } from './pages/Quiz';
import { Read } from './pages/Read';
import { GrammarDetail } from './pages/GrammarDetail';
import { MockTest } from './pages/MockTest';
import { Wordle } from './pages/Wordle';
import { Crossword } from './pages/Crossword';
import { Literature } from './pages/Literature';
import { LitReader } from './pages/LitReader';
import { ComicReader } from './pages/ComicReader';
import { VideoImport } from './pages/VideoImport';
import { VideoPlayer } from './pages/VideoPlayer';
import { MangaImport } from './pages/MangaImport';
import { MangaReader } from './pages/MangaReader';
import { Decks } from './pages/Decks';
import { AnkiImport } from './pages/AnkiImport';
import { Practice } from './pages/Practice';
import { Weak } from './pages/Weak';
import { Speak } from './pages/Speak';
import { Roleplay } from './pages/Roleplay';
import { Shadow } from './pages/Shadow';
import { Responses } from './pages/Responses';
import { Library } from './pages/Library';
import { KanjiDetail } from './pages/KanjiDetail';
import { Progress } from './pages/Progress';
import { SettingsPage } from './pages/Settings';
import { NewPassword, Welcome } from './pages/Welcome';
import { useSyncStatus } from './sync/sync';

const TABS = [
  { to: '/', label: 'Today', jp: '今日' },
  { to: '/library', label: 'Library', jp: '辞書' },
  { to: '/progress', label: 'Progress', jp: '進歩' },
  { to: '/settings', label: 'Settings', jp: '設定' },
];

/** Full-screen activities hide the tab bar so nothing distracts from studying. */
const FOCUS_ROUTES = ['/study', '/listen', '/quiz', '/read', '/mock', '/practice', '/weak', '/speak', '/wordle', '/crossword', '/literature/', '/comics/', '/videos/', '/manga/', '/decks'];

export function App() {
  const settings = useLiveSettings();
  useTheme(settings?.theme);
  const { pack, error } = useLoadedPack(settings?.lang);
  const location = useLocation();
  const sync = useSyncStatus();
  // With accounts configured, nothing opens until someone signs in: progress belongs to an account.
  const gate = sync.phase === 'checking' ? 'wait' : sync.recovering ? 'recover' : sync.phase === 'signed-out' ? 'sign-in' : null;
  const focus = !!gate || FOCUS_ROUTES.some((r) => location.pathname.startsWith(r));
  const activeTab = TABS.findIndex((t) => (t.to === '/' ? location.pathname === '/' : location.pathname.startsWith(t.to)));

  return (
    <>
      <main className={`app${focus ? ' focus' : ''}`}>
        {error ? (
          <div className="empty">
            <span className="jp">困</span>
            Could not load the study content. Open the app once while online so it can be saved for offline use.
            <div className="faint">{error}</div>
          </div>
        ) : !pack || !settings || gate === 'wait' ? (
          <div className="empty">
            <span className="jp">…</span>
          </div>
        ) : gate ? (
          <PackContext.Provider value={pack}>
            <div className="page">{gate === 'recover' ? <NewPassword /> : <Welcome />}</div>
          </PackContext.Provider>
        ) : (
          <SettingsContext.Provider value={settings}>
          <PackContext.Provider value={pack}>
            {/* keyed by path so every navigation replays the page entrance */}
            <div className="page" key={location.pathname}>
              <Routes>
                <Route path="/" element={<Today />} />
                <Route path="/study" element={<Study />} />
                <Route path="/listen" element={<Listen />} />
                <Route path="/quiz" element={<Quiz />} />
                <Route path="/read" element={<Read />} />
                <Route path="/mock" element={<MockTest />} />
                <Route path="/practice" element={<Practice />} />
                <Route path="/weak" element={<Weak />} />
                <Route path="/speak" element={<Speak />} />
                <Route path="/speak/roleplay/:id" element={<Roleplay />} />
                <Route path="/speak/shadow" element={<Shadow />} />
                <Route path="/speak/responses" element={<Responses />} />
                <Route path="/wordle" element={<Wordle />} />
                <Route path="/crossword" element={<Crossword />} />
                <Route path="/literature" element={<Literature />} />
                <Route path="/literature/:id" element={<LitReader />} />
                <Route path="/comics/:id" element={<ComicReader />} />
                <Route path="/videos/new" element={<VideoImport />} />
                <Route path="/videos/:id" element={<VideoPlayer />} />
                <Route path="/manga/new" element={<MangaImport />} />
                <Route path="/manga/:id" element={<MangaReader />} />
                <Route path="/decks" element={<Decks />} />
                <Route path="/decks/import" element={<AnkiImport />} />
                <Route path="/library" element={<Library />} />
                <Route path="/kanji/:char" element={<KanjiDetail />} />
                <Route path="/grammar/:id" element={<GrammarDetail />} />
                <Route path="/progress" element={<Progress />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Today />} />
              </Routes>
            </div>
          </PackContext.Provider>
          </SettingsContext.Provider>
        )}
      </main>
      {!focus && (
        <nav className="nav" aria-label="Main">
          <ul style={{ '--tab': activeTab } as CSSProperties}>
            {activeTab >= 0 && <li className="nav-ink" aria-hidden="true" />}
            {TABS.map((t) => (
              <li key={t.to}>
                <NavLink to={t.to} end={t.to === '/'}>
                  <span className="nav-jp" aria-hidden="true">
                    {t.jp}
                  </span>
                  {t.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}
