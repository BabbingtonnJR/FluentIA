import { NavLink, Route, Routes, useLocation } from 'react-router';
import { PackContext, SettingsContext, useLiveSettings, useLoadedPack, useTheme } from './hooks';
import { Today } from './pages/Today';
import { Study } from './pages/Study';
import { Listen } from './pages/Listen';
import { Quiz } from './pages/Quiz';
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
const FOCUS_ROUTES = ['/study', '/listen', '/quiz'];

export function App() {
  const settings = useLiveSettings();
  useTheme(settings?.theme);
  const { pack, error } = useLoadedPack(settings?.lang);
  const location = useLocation();
  const focus = FOCUS_ROUTES.some((r) => location.pathname.startsWith(r));

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
            <Routes>
              <Route path="/" element={<Today />} />
              <Route path="/study" element={<Study />} />
              <Route path="/listen" element={<Listen />} />
              <Route path="/quiz" element={<Quiz />} />
              <Route path="/library" element={<Library />} />
              <Route path="/kanji/:char" element={<KanjiDetail />} />
              <Route path="/progress" element={<Progress />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Today />} />
            </Routes>
          </PackContext.Provider>
          </SettingsContext.Provider>
        )}
      </main>
      {!focus && (
        <nav className="nav" aria-label="Main">
          <ul>
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
