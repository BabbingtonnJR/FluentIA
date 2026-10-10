import type { CSSProperties } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router';
import { PackContext, SettingsContext, useLiveSettings, useLoadedPack, useTheme } from './hooks';
import { Today } from './pages/Today';
import { Study } from './pages/Study';
import { Listen } from './pages/Listen';
import { Quiz } from './pages/Quiz';
import { Read } from './pages/Read';
import { Library } from './pages/Library';
import { KanjiDetail } from './pages/KanjiDetail';
import { Progress } from './pages/Progress';
import { SettingsPage } from './pages/Settings';

const TABS = [
  { to: '/', label: 'Today', jp: '今日' },
  { to: '/library', label: 'Library', jp: '辞書' },
  { to: '/progress', label: 'Progress', jp: '進歩' },
  { to: '/settings', label: 'Settings', jp: '設定' },
];

/** Full-screen activities hide the tab bar so nothing distracts from studying. */
const FOCUS_ROUTES = ['/study', '/listen', '/quiz', '/read'];

export function App() {
  const settings = useLiveSettings();
  useTheme(settings?.theme);
  const { pack, error } = useLoadedPack(settings?.lang);
  const location = useLocation();
  const focus = FOCUS_ROUTES.some((r) => location.pathname.startsWith(r));
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
        ) : !pack || !settings ? (
          <div className="empty">
            <span className="jp">…</span>
          </div>
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
                <Route path="/library" element={<Library />} />
                <Route path="/kanji/:char" element={<KanjiDetail />} />
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
