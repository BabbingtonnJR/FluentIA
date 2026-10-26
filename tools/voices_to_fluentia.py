# Records natural Japanese audio for Fluentia with VOICEVOX (free neural text-to-speech that runs
# on this computer): every word in the word list and every line of the speaking practice, so the app
# (and hands-free mode above all) plays a human-like voice instead of the browser's robotic one.
# It also notes each word's pitch accent as VOICEVOX's dictionary gives it.
#
# Run through tools/voices-to-fluentia.ps1, which starts the VOICEVOX engine first.
# Output (incremental: files already made are kept):
#   public/audio/ja/w/<n>.mp3     a word (n = its index in vocab.json)
#   public/audio/ja/s/<hash>.mp3  a line of the speaking practice (and, with --sentences, example sentences)
#   public/audio/ja/index.json    what was recorded, read by the app (src/speech/audio.ts)
#   public/packs/ja/pitch.json    pitch accent per word: [[morae, accent], ...] per accent phrase
import argparse
import hashlib
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import av

ENGINE = 'http://127.0.0.1:50021'
ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / 'public' / 'packs' / 'ja'
OUT = ROOT / 'public' / 'audio' / 'ja'

# VOICEVOX's terms ask that each voice used is credited as "VOICEVOX:<name>".
MAIN_VOICE = ('冥鳴ひまり', 'ノーマル')
ALT_VOICE = ('青山龍星', 'ノーマル')


def call(path, params=None, body=None):
    url = f'{ENGINE}{path}' + ('?' + urllib.parse.urlencode(params) if params else '')
    data = json.dumps(body).encode() if body is not None else (b'' if path in ('/audio_query', '/synthesis') else None)
    req = urllib.request.Request(url, data=data, method='POST' if data is not None else 'GET', headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
        return raw if path == '/synthesis' else json.loads(raw)


def speaker_id(name, style):
    speakers = call('/speakers')
    for s in speakers:
        if s['name'] == name:
            for st in s['styles']:
                if st['name'] == style:
                    return st['id']
    sys.exit(f'Voice {name} ({style}) not found. Voices: {", ".join(s["name"] for s in speakers)}')


def kata2hira(s):
    return ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in s)


def word_key(word):
    return re.sub(r'[～〜~]', '', re.split(r'[;；]', word)[0]).strip()


def norm_reading(reading):
    r = re.split(r'[;；、,]', reading)[0]
    r = re.sub(r'[(（][^)）]*[)）]', '', r)
    return kata2hira(re.sub(r'[～〜~\s.\-]', '', r))


def text_key(text):
    """Same as textKey in src/speech/audio.ts."""
    return re.sub(r'[。.]$', '', re.sub(r'\s+', '', text))


def query_kana(query):
    """What the query will say, as plain katakana."""
    return ''.join(m['text'] for p in query['accent_phrases'] for m in p['moras'])


def mp3(wav_bytes, path):
    """WAV from VOICEVOX → small mono MP3 (32 kbps is plenty for speech)."""
    inp = av.open(io.BytesIO(wav_bytes))
    out = av.open(str(path), 'w', format='mp3')
    stream = out.add_stream('libmp3lame', rate=24000)
    stream.bit_rate = 32000
    stream.layout = 'mono'
    resampler = av.AudioResampler(format='s16p', layout='mono', rate=24000)
    for frame in inp.decode(audio=0):
        for f in resampler.resample(frame):
            for packet in stream.encode(f):
                out.mux(packet)
    for f in resampler.resample(None):
        for packet in stream.encode(f):
            out.mux(packet)
    for packet in stream.encode(None):
        out.mux(packet)
    out.close()
    inp.close()


def record(query, speaker, path):
    query['prePhonemeLength'] = 0.05
    query['postPhonemeLength'] = 0.08
    wav = call('/synthesis', {'speaker': speaker}, query)
    path.parent.mkdir(parents=True, exist_ok=True)
    mp3(wav, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sentences', action='store_true', help='also record the example sentences shown on word cards (about 7,000)')
    ap.add_argument('--limit', type=int, default=0, help='stop after this many new recordings (for a quick test)')
    args = ap.parse_args()

    main_id = speaker_id(*MAIN_VOICE)
    alt_id = speaker_id(*ALT_VOICE)
    vocab = json.loads((PACK / 'vocab.json').read_text('utf8'))
    speaking = json.loads((PACK / 'speaking.json').read_text('utf8'))

    index_path = OUT / 'index.json'
    index = json.loads(index_path.read_text('utf8')) if index_path.exists() else {}
    words, text, alt = index.get('words', {}), index.get('text', {}), index.get('alt', {})
    pitch_path = PACK / 'pitch.json'
    pitch = json.loads(pitch_path.read_text('utf8')) if pitch_path.exists() else {}
    made = 0

    def budget():
        return not args.limit or made < args.limit

    # --- Words: written form first (so the accent is the word's), kana when that is read otherwise.
    for i, v in enumerate(vocab):
        if not budget():
            break
        reading = norm_reading(v['reading'])
        if not reading:
            continue
        written = word_key(v['word'])
        path = OUT / 'w' / f'{i}.mp3'
        if v['id'] in words and path.exists():
            continue
        query = call('/audio_query', {'text': written, 'speaker': main_id})
        if kata2hira(query_kana(query)) != reading:
            query = call('/audio_query', {'text': reading, 'speaker': main_id})
            pitch.pop(v['id'], None)
        else:
            # Only trusted when the dictionary read the written word the way the list does.
            pitch[v['id']] = [[len(p['moras']), p['accent']] for p in query['accent_phrases']]
        if not path.exists():
            record(query, main_id, path)
            made += 1
        words[v['id']] = f'w/{i}.mp3'
        # The reading alone (quizzes speak readings) plays the first word read that way.
        text.setdefault(text_key(reading), f'w/{i}.mp3')
        if made and made % 200 == 0:
            print(f'  {made} recorded, at word {i + 1} / {len(vocab)}', flush=True)

    # --- Lines: the main voice, and the second voice where a dialogue or quiz uses it.
    lines = []  # (text, alt)
    for d in speaking['dialogues']:
        for l in d['lines']:
            lines.append((l['say'], l['who'] % 2 == 1))
        for q in d['questions']:
            lines.append((q['say'], False))
    for r in speaking['responses']:
        if r.get('prompt'):
            lines.append((r['prompt']['say'], True))
        lines.append((r['good']['say'], False))
        lines.extend((b['say'], False) for b in r['bad'])
    if args.sentences:
        examples = json.loads((PACK / 'examples.json').read_text('utf8'))
        for w in examples['words'].values():
            for x in w.get('x', []):
                lines.append((re.sub(r'\[([^|\]]+)\|[^\]]*\]', r'\1', x[0]), False))

    for say, is_alt in lines:
        if not budget():
            break
        key = text_key(say)
        table = alt if is_alt else text
        if key in table and (OUT / table[key]).exists():
            continue
        speaker = alt_id if is_alt else main_id
        name = 's/' + hashlib.sha1(f'{speaker}|{key}'.encode()).hexdigest()[:12] + '.mp3'
        if not (OUT / name).exists():
            record(call('/audio_query', {'text': say, 'speaker': speaker}), speaker, OUT / name)
            made += 1
            if made % 200 == 0:
                print(f'  {made} recorded', flush=True)
        table[key] = name

    credit = f'VOICEVOX:{MAIN_VOICE[0]}, VOICEVOX:{ALT_VOICE[0]}'
    OUT.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps({'credit': credit, 'words': words, 'text': text, 'alt': alt}, ensure_ascii=False, separators=(',', ':')), 'utf8')
    pitch_path.write_text(json.dumps(pitch, ensure_ascii=False, separators=(',', ':')), 'utf8')
    size = sum(f.stat().st_size for f in OUT.rglob('*.mp3')) / 1e6
    print(f'Done: {made} new recordings; {len(words)} words, {len(text) + len(alt)} lines; {size:.1f} MB of audio. Credit: {credit}')


if __name__ == '__main__':
    main()
