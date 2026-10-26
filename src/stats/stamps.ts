// Collectibles: a stamp book (御朱印帳) with a vermilion seal for each milestone, and a tree that
// grows with the learner's level, from a seed to a cherry tree in bloom.
import type { ActivityRecord, CardRecord, MistakeRecord } from '../db/types';
import { likelyPass, SECTIONS } from '../quiz/mock';
import { isMature, State } from '../srs/scheduler';

export interface StampInput {
  cards: CardRecord[];
  activities: ActivityRecord[];
  mistakes: MistakeRecord[];
  reviews: number;
  bestStreak: number;
}

export interface Stamp {
  id: string;
  /** The character on the seal. */
  seal: string;
  title: string;
  how: string;
  earned: boolean;
  /** How far along, for stamps not earned yet: [now, needed]. */
  progress?: [number, number];
}

/** Every stamp, earned or not, in the order they are usually earned. */
export function stamps({ cards, activities, mistakes, reviews, bestStreak }: StampInput): Stamp[] {
  const seen = cards.filter((c) => !c.deleted && c.direction === 'recognition' && c.state !== State.New);
  const count = (kind: CardRecord['kind']) => seen.filter((c) => c.kind === kind).length;
  const did = (type: ActivityRecord['type']) => activities.filter((a) => a.type === type).length;
  const mature = cards.filter((c) => !c.deleted && isMature(c)).length;
  const passed = (level: number) =>
    activities.some((a) => {
      if (a.type !== 'mock' || a.detail?.level !== level) return false;
      const sections = SECTIONS.flatMap((s) => {
        const r = a.detail!.sections[s.id];
        return r ? [{ section: s.id, correct: r[0], total: r[1] }] : [];
      });
      return likelyPass(level, { sections, correct: a.score, total: a.total });
    });
  const resolved = mistakes.filter((m) => m.resolvedAt).length;

  const at = (id: string, seal: string, title: string, how: string, now: number, needed: number): Stamp => ({
    id,
    seal,
    title,
    how,
    earned: now >= needed,
    ...(now < needed ? { progress: [now, needed] as [number, number] } : {}),
  });

  return [
    at('first', '初', 'First steps', 'Review your first card', reviews, 1),
    at('week', '週', 'One week', 'Study 7 days in a row', bestStreak, 7),
    at('words100', '語', 'A hundred words', 'Learn 100 words', count('vocab'), 100),
    at('kanji50', '漢', 'Fifty kanji', 'Learn 50 kanji', count('kanji'), 50),
    at('grammar30', '文', 'Grammar', 'Learn 30 grammar points', count('grammar'), 30),
    at('speak', '話', 'First words', 'Finish a role-play', did('roleplay'), 1),
    at('shadow', '影', 'Shadow', 'Shadow 50 sentences', activities.filter((a) => a.type === 'shadowing').reduce((n, a) => n + a.score, 0), 50),
    at('replies', '即', 'Quick on your feet', 'Do 5 rounds of quick replies', did('responses'), 5),
    at('read', '読', 'Reader', 'Read 5 timed passages', did('passages'), 5),
    at('story', '物', 'Storyteller', 'Read in the literature shelf 10 times', did('literature'), 10),
    at('mock', '模', 'Test day', 'Take a mock test', did('mock'), 1),
    at('fix', '直', 'Fixed it', 'Get 20 mistakes right in a drill', resolved, 20),
    at('month', '月', 'One month', 'Study 30 days in a row', bestStreak, 30),
    at('mature100', '熟', 'Deep roots', 'Have 100 cards you know well (mature)', mature, 100),
    at('words1000', '千', 'A thousand words', 'Learn 1,000 words', count('vocab'), 1000),
    at('n4', '四', 'N4 level', 'Score a likely pass on an N4 mock', passed(4) ? 1 : 0, 1),
    at('n3', '三', 'N3 level', 'Score a likely pass on an N3 mock', passed(3) ? 1 : 0, 1),
    at('hundred', '百', 'A hundred days', 'Study 100 days in a row', bestStreak, 100),
  ];
}

/** The tree's stages by level: what it looks like and what it's called. */
export const TREE_STAGES = [
  { from: 1, jp: '種', name: 'Seed' },
  { from: 3, jp: '芽', name: 'Sprout' },
  { from: 6, jp: '苗', name: 'Seedling' },
  { from: 10, jp: '若木', name: 'Young tree' },
  { from: 15, jp: '木', name: 'Tree' },
  { from: 20, jp: '桜', name: 'Cherry in bloom' },
] as const;

export function treeStage(level: number): number {
  let stage = 0;
  TREE_STAGES.forEach((s, i) => {
    if (level >= s.from) stage = i;
  });
  return stage;
}
