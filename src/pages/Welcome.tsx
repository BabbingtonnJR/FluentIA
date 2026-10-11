import { useState, type FormEvent } from 'react';
import { saveSettings } from '../db/repo';
import { usePack } from '../hooks';
import { sendPasswordReset, setNewPassword, signIn, signUp } from '../sync/sync';

type Mode = 'in' | 'up' | 'reset';

/** Friendlier wording for the errors students actually hit. */
function explain(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password.';
  if (/already registered|already exists/i.test(message)) return 'There is already an account with this email. Sign in instead.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/failed to fetch|network/i.test(message)) return 'No connection. Connect to the internet to sign in.';
  return message;
}

/**
 * The first screen when accounts are on: sign in, create an account (choosing the level to start
 * with) or ask for a password reset. Each account keeps its own progress.
 */
export function Welcome() {
  const pack = usePack();
  const levels = pack.manifest.levels;
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [level, setLevel] = useState(levels[0]?.id ?? 5);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      if (mode === 'in') await signIn(email.trim(), password);
      else if (mode === 'up') {
        if ((await signUp(email.trim(), password)) === 'confirm-email') {
          setNote({ text: 'Check your email to confirm the account, then sign in.', error: false });
          setMode('in');
        } else await saveSettings({ levels: [level] });
      } else {
        await sendPasswordReset(email.trim());
        setNote({ text: 'If this email has an account, a link to choose a new password is on its way.', error: false });
      }
    } catch (err) {
      setNote({ text: explain(err instanceof Error ? err.message : String(err)), error: true });
    } finally {
      setBusy(false);
    }
  }

  const switchTo = (m: Mode) => {
    setMode(m);
    setNote(null);
  };

  return (
    <div className="stack welcome">
      <header className="page-head">
        <h1>
          Fluentia<span className="kanji-mark">{pack.manifest.nativeName}</span>
        </h1>
      </header>
      <p className="faint" style={{ margin: 0 }}>
        {mode === 'reset' ? 'We will email you a link to choose a new password.' : 'Your progress is saved to your account, so you can continue on any device.'}
      </p>

      {mode !== 'reset' && (
        <div className="segmented" role="group" aria-label="Account">
          <button className={mode === 'in' ? 'on' : ''} onClick={() => switchTo('in')} type="button">
            Sign in
          </button>
          <button className={mode === 'up' ? 'on' : ''} onClick={() => switchTo('up')} type="button">
            Create account
          </button>
        </div>
      )}

      <form className="card stack" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode !== 'reset' && (
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'up' && <span className="faint">At least 6 characters.</span>}
          </div>
        )}
        {mode === 'up' && (
          <div className="field">
            <span className="label">Start at level</span>
            <div className="segmented" role="group" aria-label="Level">
              {levels.map((l) => (
                <button key={l.id} type="button" className={level === l.id ? 'on' : ''} onClick={() => setLevel(l.id)}>
                  {l.label}
                </button>
              ))}
            </div>
            <span className="faint">New to Japanese? Start at {levels[0]?.label}. You can add levels later in Settings.</span>
          </div>
        )}
        {note && <div className={`notice${note.error ? ' error' : ''}`}>{note.text}</div>}
        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? '…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send link'}
        </button>
      </form>

      <button className="btn ghost" type="button" onClick={() => switchTo(mode === 'reset' ? 'in' : 'reset')}>
        {mode === 'reset' ? 'Back to sign in' : 'Forgot your password?'}
      </button>
    </div>
  );
}

/** Shown after opening a password reset link: choose the new password, then the app opens. */
export function NewPassword() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setNewPassword(password);
    } catch (err) {
      setError(explain(err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  }

  return (
    <form className="stack welcome" onSubmit={(e) => void submit(e)}>
      <header className="page-head">
        <h1>New password</h1>
      </header>
      <div className="card stack">
        <div className="field">
          <label htmlFor="new-password">Choose a new password</label>
          <input
            id="new-password"
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className="notice error">{error}</div>}
        <button className="btn primary block" type="submit" disabled={busy}>
          Save and continue
        </button>
      </div>
    </form>
  );
}
