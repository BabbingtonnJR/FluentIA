import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { db } from '../db/db';
import type { MangaImage, MangaRecord } from '../db/types';
import { usePack } from '../hooks';
import { baseName, IMAGE_TYPES, parseMokuro } from '../manga/mokuro';
import { readZip, type ZipEntry } from '../manga/zip';
import { analyseTexts } from '../video/analyse';

type Stage = { step: 'idle' } | { step: 'reading' } | { step: 'dictionary' } | { step: 'bubbles'; done: number; total: number } | { step: 'saving' };

const share = (n: number, of: number) => Math.round((n / of) * 10000) / 10000;

/** A loose file picked from the device, shaped like a zip entry. */
const fileEntry = (f: File): ZipEntry => ({ name: f.name, size: f.size, read: async () => new Uint8Array(await f.arrayBuffer()) });

/**
 * Imports a manga volume processed by mokuro on a computer: the volume folder zipped (with its
 * .mokuro file and images), or the .mokuro file plus the images picked together. Each bubble gets
 * the word-by-word breakdown; everything stays on this device.
 */
export function MangaImport() {
  const pack = usePack();
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const busy = stage.step !== 'idle';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!files.length) return;
    setError(null);
    try {
      setStage({ step: 'reading' });
      const zip = files.find((f) => /\.(zip|cbz)$/i.test(f.name));
      const entries = zip ? readZip(await zip.arrayBuffer()) : files.map(fileEntry);
      const mokuroFile = entries.find((f) => f.name.toLowerCase().endsWith('.mokuro'));
      if (!mokuroFile) throw new Error('No .mokuro file found. Run mokuro on the volume folder first, then zip the folder with it.');
      const volume = parseMokuro(new TextDecoder().decode(await mokuroFile.read()));
      const images = new Map(entries.filter((f) => IMAGE_TYPES[f.name.split('.').pop()!.toLowerCase()]).map((f) => [baseName(f.name), f]));
      if (!volume.pages.some((p) => images.has(baseName(p.imgPath)))) throw new Error('The page images were not found next to the .mokuro file.');

      setStage({ step: 'dictionary' });
      const texts = volume.pages.flatMap((p) => p.blocks.map((b) => b.text));
      const sentences = await analyseTexts(texts, pack, (done) => setStage({ step: 'bubbles', done, total: texts.length }));

      setStage({ step: 'saving' });
      const id = crypto.randomUUID();
      let k = 0;
      const pages: MangaRecord['pages'] = [];
      const pageImages: MangaImage[] = [];
      for (const p of volume.pages) {
        const img = images.get(baseName(p.imgPath));
        if (!img) {
          k += p.blocks.length;
          continue;
        }
        const ext = img.name.split('.').pop()!.toLowerCase();
        pageImages.push({ id: `${id}:${pages.length}`, mangaId: id, page: pages.length, blob: new Blob([await img.read()], { type: IMAGE_TYPES[ext] }) });
        pages.push({
          b: p.blocks.map((b) => ({
            box: [share(b.box[0], p.width), share(b.box[1], p.height), share(b.box[2], p.width), share(b.box[3], p.height)],
            s: sentences[k++],
          })),
        });
      }
      const fallbackTitle = (zip?.name ?? mokuroFile.name).replace(/\.[^.]+$/, '');
      await db.transaction('rw', db.manga, db.mangaPages, async () => {
        await db.manga.add({
          id,
          lang: pack.manifest.id,
          title: title.trim() || volume.title || fallbackTitle,
          createdAt: Date.now(),
          source: zip?.name ?? mokuroFile.name,
          pages,
        });
        await db.mangaPages.bulkAdd(pageImages);
      });
      navigate(`/manga/${id}`, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/quota/i.test(message) ? 'Not enough space on this device for this volume.' : message);
      setStage({ step: 'idle' });
    }
  }

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/literature?tab=manga')} aria-label="Back">
          <Icon name="close" />
        </button>
        <h2 className="wordle-title">Import a manga</h2>
      </div>

      <div className="card stack" style={{ padding: '12px 14px', gap: 6 }}>
        <strong>On your computer</strong>
        <ol className="faint" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          <li>Put the volume's page images in a folder.</li>
          <li>
            Run <code>tools\manga-to-fluentia.ps1 "path\to\folder"</code> from the Fluentia folder. It reads the text in every bubble with
            mokuro and makes a <code>.fluentia.zip</code> next to the folder. (Or run <code>mokuro</code> yourself and zip the folder with
            its <code>.mokuro</code> file.)
          </li>
          <li>Send the zip to this device and pick it here.</li>
        </ol>
      </div>

      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Zip from mokuro (or the .mokuro file and the page images)</span>
          <input
            type="file"
            multiple
            accept=".zip,.cbz,.mokuro,image/*,application/zip"
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])];
              setFiles(picked);
              const named = picked.find((f) => /\.(zip|cbz|mokuro)$/i.test(f.name));
              if (named && !title) setTitle(named.name.replace(/\.[^.]+$/, ''));
            }}
            disabled={busy}
            required
          />
        </label>
        <label className="field">
          <span>Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        </label>

        {error && (
          <div className="empty" style={{ padding: 0 }}>
            {error}
          </div>
        )}

        <button className="btn primary block" type="submit" disabled={!files.length || busy}>
          {stage.step === 'reading'
            ? 'Reading the files…'
            : stage.step === 'dictionary'
              ? 'Loading the dictionary (first time ~17 MB)…'
              : stage.step === 'bubbles'
                ? `Breaking down bubbles… ${stage.done}/${stage.total}`
                : stage.step === 'saving'
                  ? 'Saving the pages…'
                  : 'Import'}
        </button>
      </form>

      <p className="faint" style={{ fontSize: '0.8rem' }}>
        Only import manga you own, without DRM. The text comes from OCR, so a few characters may be misread.
      </p>
    </div>
  );
}
