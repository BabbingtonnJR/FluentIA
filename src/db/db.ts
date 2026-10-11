import Dexie, { type EntityTable } from 'dexie';
import type { ActivityRecord, CardRecord, DeckRecord, KvRecord, MangaImage, MangaRecord, MediaRecord, MetaRecord, NoteRecord, ReviewRecord, VideoRecord } from './types';

export class FluentiaDB extends Dexie {
  cards!: EntityTable<CardRecord, 'id'>;
  reviews!: EntityTable<ReviewRecord, 'id'>;
  activities!: EntityTable<ActivityRecord, 'id'>;
  kv!: EntityTable<KvRecord, 'id'>;
  meta!: EntityTable<MetaRecord, 'key'>;
  videos!: EntityTable<VideoRecord, 'id'>;
  manga!: EntityTable<MangaRecord, 'id'>;
  mangaPages!: EntityTable<MangaImage, 'id'>;
  decks!: EntityTable<DeckRecord, 'id'>;
  notes!: EntityTable<NoteRecord, 'id'>;
  media!: EntityTable<MediaRecord, 'id'>;

  constructor(name = 'fluentia') {
    super(name);
    this.version(1).stores({
      cards: 'id, [lang+due], [lang+kind], [lang+createdAt], updatedAt',
      reviews: 'id, cardId, [lang+reviewedAt], updatedAt',
      activities: 'id, [lang+day], updatedAt',
      kv: 'id, updatedAt',
      meta: 'key',
    });
    // Imported videos and their subtitles stay on this device (not synced: videos are large).
    this.version(2).stores({ videos: 'id, [lang+createdAt]' });
    // Imported manga (mokuro): text and layout in manga, page images apart so a page loads alone.
    this.version(3).stores({ manga: 'id, [lang+createdAt]', mangaPages: 'id, mangaId' });
    // Decks imported from Anki and their notes (synced with the account).
    this.version(4).stores({ decks: 'id, lang, updatedAt', notes: 'id, deckId, updatedAt' });
    // Their pictures and sounds, on this device only.
    this.version(5).stores({ media: 'id' });
  }
}

export const db = new FluentiaDB();

/** Tables that are synced to the server, by their remote collection name. */
export const SYNCED_TABLES = ['cards', 'reviews', 'activities', 'kv', 'decks', 'notes'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];
