import { useEffect, useState, type FormEvent } from 'react';
import { exportBackup, importBackup, markLevelKnown, saveSettings, type Backup } from '../db/repo';
import type { Theme } from '../db/types';
import { usePack, useSettings } from '../hooks';
import { FURIGANA_LABEL } from '../reading/furigana';
import { speak, voicesFor } from '../speech/tts';
import { signIn, signOut, signUp, syncNow, useSyncStatus } from '../sync/sync';

const NEW_PER_DAY = [10, 15, 20, 25, 30, 40];
const GRAMMAR_PER_DAY = [0, 1, 2, 3, 5];
const RATES = [
  { value: 0.7, label: 'Slow' },
  { value: 0.9, label: 'Normal' },
  { value: 1.05, label: 'Fast' },
];

export function SettingsPage() {
  const pack = usePack();
  const settings = useSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    voicesFor(pack.manifest.ttsLocale).then(setVoices);
  }, [pack]);

  const toggleLevel = (level: number) => {
    const levels = settings.levels.includes(level) ? settings.levels.filter((l) => l !== level) : [...settings.levels, level];
    void saveSettings({ levels });
  };

  async function markKnown(level: number, label: string) {
    if (!confirm(`Mark every ${label} word and kanji you have not studied yet as known? They will come back for occasional review over the next few months.`)) return;
    const n = await markLevelKnown(pack, level);
    setMessage(`${n} ${label} cards marked as known.`);
  }

  async function doExport() {
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fluentia-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function doImport(file: File) {
    try {
      const n = await importBackup(JSON.parse(await file.text()) as Backup);
      setMessage(`Imported ${n} records.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not read that file.');
    }
  }

  return (
    <div className="stack">
      <header className="page-head">
        <h1>
          Settings<span className="kanji-mark">設定</span>
        </h1>
      </header>

      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}

      <div className="section-title">Study</div>
      <div className="card stack">
        <div className="field">
          <span className="label">Levels to learn</span>
          <div className="chips">
            {pack.manifest.levels.map((l) => (
              <button key={l.id} className={`chip${settings.levels.includes(l.id) ? ' on' : ''}`} onClick={() => toggleLevel(l.id)} aria-pressed={settings.levels.includes(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
          <span className="faint">New cards come from the easiest selected level first.</span>
        </div>

        <div className="field">
          <span className="label">New cards per day</span>
          <div className="segmented" role="group">
            {NEW_PER_DAY.map((n) => (
              <button key={n} className={settings.newPerDay === n ? 'on' : ''} onClick={() => void saveSettings({ newPerDay: n })}>
                {n}
              </button>
            ))}
          </div>
          <span className="faint">Each new card adds about 5–10 reviews over the following weeks.</span>
        </div>

        {pack.grammar.length > 0 && (
          <div className="field">
            <span className="label">New grammar points per day</span>
            <div className="segmented" role="group">
              {GRAMMAR_PER_DAY.map((n) => (
                <button key={n} className={settings.grammarPerDay === n ? 'on' : ''} onClick={() => void saveSettings({ grammarPerDay: n })}>
                  {n === 0 ? 'Off' : n}
                </button>
              ))}
            </div>
            <span className="faint">On top of the new cards above. Each review shows the pattern in a different sentence.</span>
          </div>
        )}

        <label className="switch-row">
          <span>
            <strong>Speaking practice</strong>
            <div className="faint">English → Japanese cards for words you already recognise.</div>
          </span>
          <input type="checkbox" checked={settings.production} onChange={(e) => void saveSettings({ production: e.target.checked })} />
        </label>

        <div className="field">
          <span className="label">Already know a level?</span>
          <div className="chips">
            {pack.manifest.levels.map((l) => (
              <button key={l.id} className="chip" onClick={() => void markKnown(l.id, l.label)}>
                Mark {l.label} as known
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="section-title">Audio</div>
      <div className="card stack">
        <label className="switch-row">
          <strong>Play audio when revealing a card</strong>
          <input type="checkbox" checked={settings.autoplay} onChange={(e) => void saveSettings({ autoplay: e.target.checked })} />
        </label>
        <div className="field">
          <label htmlFor="voice">Japanese voice</label>
          {voices.length ? (
            <select id="voice" className="input" value={settings.voiceURI ?? ''} onChange={(e) => void saveSettings({ voiceURI: e.target.value || null })}>
              <option value="">Default</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="faint">No Japanese voice found. On iPhone: Settings → Accessibility → Spoken Content → Voices → Japanese.</span>
          )}
        </div>
        <div className="field">
          <span className="label">Speed</span>
          <div className="segmented" role="group">
            {RATES.map((r) => (
              <button key={r.value} className={settings.speechRate === r.value ? 'on' : ''} onClick={() => void saveSettings({ speechRate: r.value })}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <button
          className="btn"
          onClick={() => void speak('日本語を勉強しています', { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate })}
        >
          Test voice
        </button>
      </div>

      <div className="section-title">Appearance</div>
      <div className="card stack">
        <div className="segmented" role="group" aria-label="Theme">
          {(['auto', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => void saveSettings({ theme: t })}>
              {t === 'auto' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
        <div className="field">
          <span className="label">Furigana in readings</span>
          <div className="segmented" role="group" aria-label="Furigana">
            {(['all', 'unknown', 'none'] as const).map((f) => (
              <button key={f} className={settings.furigana === f ? 'on' : ''} onClick={() => void saveSettings({ furigana: f })}>
                {FURIGANA_LABEL[f]}
              </button>
            ))}
          </div>
          <span className="faint">“New kanji” shows readings only over kanji you have not studied yet.</span>
        </div>
      </div>

      <div className="section-title">Sync between devices</div>
      <SyncSection />

      <div className="section-title">Backup</div>
      <div className="card stack">
        <p className="faint" style={{ margin: 0 }}>
          Your progress is saved on this device. Export a file now and then as an extra safety net.
        </p>
        <div className="grid-2">
          <button className="btn" onClick={() => void doExport()}>
            Export
          </button>
          <label className="btn">
            Import
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])} />
          </label>
        </div>
      </div>

      <div className="section-title">About</div>
      <div className="card faint stack" style={{ gap: 6 }}>
        <div>
          Fluentia {pack.manifest.nativeName} · {pack.manifest.counts.vocab} words, {pack.manifest.counts.kanji} kanji
        </div>
        <div>
          Vocabulary lists: open-anki-jlpt-decks (MIT), based on Jonathan Waller's JLPT lists (tanos.co.uk, CC BY). Kanji: KANJIDIC
          (EDRDG, CC BY-SA 4.0). Stroke order: KanjiVG by Ulrich Apel (CC BY-SA 3.0). Scheduling: FSRS (ts-fsrs, MIT).
        </div>
      </div>
    </div>
  );
}

function SyncSection() {
  const sync = useSyncStatus();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (sync.phase === 'unconfigured') {
    return (
      <div className="card faint">
        Sync is not set up yet. Everything works offline on this device; see the README to connect a free Supabase project.
      </div>
    );
  }

  async function submit(e: FormEvent, mode: 'in' | 'up') {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      if (mode === 'in') await signIn(email, password);
      else if ((await signUp(email, password)) === 'confirm-email') setNote('Check your email to confirm the account, then sign in here.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (sync.phase === 'signed-out') {
    return (
      <form className="card stack" onSubmit={(e) => void submit(e, 'in')}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {note && <div className="notice">{note}</div>}
        <div className="grid-2">
          <button className="btn primary" type="submit" disabled={busy}>
            Sign in
          </button>
          <button className="btn" type="button" disabled={busy || !email || password.length < 6} onClick={(e) => void submit(e, 'up')}>
            Create account
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="card stack">
      <div className="spread">
        <span>
          <strong>{sync.email}</strong>
          <div className="faint">
            {sync.phase === 'syncing'
              ? 'Syncing…'
              : sync.phase === 'offline'
                ? 'Offline — will sync when you reconnect'
                : sync.lastSyncedAt
                  ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()}`
                  : 'Not synced yet'}
          </div>
        </span>
      </div>
      {sync.phase === 'error' && <div className="notice error">{sync.error}</div>}
      <div className="grid-2">
        <button className="btn" onClick={() => void syncNow()} disabled={sync.phase === 'syncing'}>
          Sync now
        </button>
        <button className="btn ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
