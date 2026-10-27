import { useEffect, useRef, useState } from 'react';
import type { LitSentence } from '../content/types';
import { bestMatch, listenOnce, Recorder, recognitionSupported, recordingSupported } from '../speech/record';
import { plainText } from '../reading/furigana';
import { Icon } from './Icon';

/** The sentence read out in kana, from its word breakdown (for comparing with what was heard). */
export function kanaOf(s: LitSentence): string {
  return s.w.map(([surface, , , kana]) => kana ?? surface).join('');
}

interface Props {
  /** What to say. */
  sentence: LitSentence;
  /** Text the voice reads for the model (numbers written as read). */
  say: string;
  /** Plays the model. */
  onListen: (text: string) => Promise<void> | void;
  /** Other acceptable things to say, for the check. */
  alsoRight?: string[];
  /** Plays the model, then starts recording straight away (shadowing). */
  shadow?: boolean;
  /** Called after each attempt (a recording or a check). */
  onAttempt?: (score: number | null) => void;
}

/**
 * Say it yourself: listen to the model, record yourself and play both back to compare, or let the
 * browser's speech recognition check what it heard (where it has one). Nothing is saved.
 */
export function SpeakBack({ sentence, say, onListen, alsoRight = [], shadow = false, onAttempt }: Props) {
  const recorder = useRef<Recorder | null>(null);
  const [state, setState] = useState<'idle' | 'recording' | 'checking'>('idle');
  const [take, setTake] = useState<string | null>(null);
  const [check, setCheck] = useState<{ heard: string; score: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const canRecord = recordingSupported();
  const canCheck = recognitionSupported();

  useEffect(
    () => () => {
      recorder.current?.release();
      abort.current?.abort();
    },
    [],
  );
  useEffect(() => () => void (take && URL.revokeObjectURL(take)), [take]);

  async function record() {
    setError(null);
    if (state === 'recording') {
      const url = (await recorder.current?.stop()) ?? null;
      setState('idle');
      setTake(url);
      if (url) void new Audio(url).play().catch(() => {});
      onAttempt?.(null);
      return;
    }
    try {
      recorder.current ??= new Recorder();
      await recorder.current.start();
      setState('recording');
      // Shadowing: speak along with the voice, so it starts as the recording does.
      if (shadow) void onListen(say);
    } catch {
      setError('The microphone is blocked. Allow it for this site in your browser settings.');
    }
  }

  async function runCheck() {
    setError(null);
    setCheck(null);
    setState('checking');
    abort.current = new AbortController();
    try {
      const heard = await listenOnce('ja-JP', abort.current.signal);
      const result = bestMatch([plainText(sentence.r), say, kanaOf(sentence), ...alsoRight], heard);
      setCheck(result);
      onAttempt?.(result.score);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setState('idle');
    }
  }

  const verdict = check && (check.score >= 0.85 ? { label: 'Clear!', cls: 'good' } : check.score >= 0.6 ? { label: 'Close', cls: 'hard' } : { label: 'Try again', cls: 'again' });

  return (
    <div className="speakback" onClick={(e) => e.stopPropagation()}>
      <div className="speakback-row">
        <button className="btn small" onClick={() => void onListen(say)} disabled={state !== 'idle'}>
          <Icon name="speaker" /> Listen
        </button>
        {canRecord && (
          <button className={`btn small${state === 'recording' ? ' rec' : ' primary'}`} onClick={() => void record()} disabled={state === 'checking'}>
            {state === 'recording' ? '■ Stop' : shadow ? '● Shadow' : '● Record'}
          </button>
        )}
        {take && state === 'idle' && (
          <button className="btn small" onClick={() => void new Audio(take).play().catch(() => {})}>
            <Icon name="play" /> Me
          </button>
        )}
        {canCheck && (
          <button className="btn small ghost" onClick={() => void runCheck()} disabled={state !== 'idle'}>
            {state === 'checking' ? 'Listening…' : 'Check me'}
          </button>
        )}
      </div>
      {state === 'recording' && <div className="faint speakback-hint">{shadow ? 'Say it along with the voice, then tap Stop.' : 'Speak now, then tap Stop to hear yourself.'}</div>}
      {check && verdict && (
        <div className={`speakback-check ${verdict.cls}`}>
          <b>{verdict.label}</b> · heard <span lang="ja">「{check.heard}」</span>
        </div>
      )}
      {error && <div className="faint speakback-hint">{error}</div>}
      {!canRecord && !canCheck && <div className="faint speakback-hint">This browser can't record. Say it out loud anyway, then compare with Listen.</div>}
    </div>
  );
}
