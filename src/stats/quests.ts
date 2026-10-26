import type { ActivityRecord } from '../db/types';

export interface Quest {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  to: string;
}

export interface QuestInput {
  dueNow: number;
  reviewedToday: number;
  learnedToday: number;
  newLeft: number;
  newPerDay: number;
  activitiesToday: ActivityRecord[];
}

export const LISTEN_GOAL_MINUTES = 5;
export const READING_GOAL = 8;

/** Today's activities. They reset at the start of each study day. */
export function dailyQuests(q: QuestInput): Quest[] {
  const quizzes = q.activitiesToday.filter((a) => a.type === 'quiz');
  const listened = q.activitiesToday.filter((a) => a.type === 'handsfree').reduce((s, a) => s + a.minutes, 0);
  const sentencesRead = q.activitiesToday.filter((a) => a.type === 'reading').reduce((s, a) => s + a.score, 0);
  const learnGoal = Math.min(q.newPerDay, q.learnedToday + q.newLeft);
  const spoken = q.activitiesToday.some((a) => a.type === 'roleplay' || a.type === 'responses' || a.type === 'shadowing');
  return [
    {
      id: 'reviews',
      title: 'Clear your reviews',
      detail: q.dueNow ? `${q.dueNow} due now` : `${q.reviewedToday} reviewed today`,
      done: q.dueNow === 0,
      to: '/study',
    },
    {
      id: 'learn',
      title: `Learn ${learnGoal} new cards`,
      detail: `${q.learnedToday} learned today`,
      done: q.newLeft === 0,
      to: '/study',
    },
    {
      id: 'quiz',
      title: 'Take the daily quiz',
      detail: quizzes.length ? `Best: ${Math.max(...quizzes.map((a) => a.score))}/${quizzes[0].total}` : '10 quick questions',
      done: quizzes.length > 0,
      to: '/quiz',
    },
    {
      id: 'read',
      title: `Read ${READING_GOAL} sentences`,
      detail: sentencesRead ? `${sentencesRead} read today` : 'Built from words you know',
      done: sentencesRead >= READING_GOAL,
      to: '/read',
    },
    {
      id: 'speak',
      title: 'Say something out loud',
      detail: spoken ? 'Done today. Well said!' : 'A role-play, a round of quick replies or some shadowing',
      done: spoken,
      to: '/speak',
    },
    {
      id: 'listen',
      title: `Listen for ${LISTEN_GOAL_MINUTES} minutes`,
      detail: `${listened} min today · good for the gym or a walk`,
      done: listened >= LISTEN_GOAL_MINUTES,
      to: '/listen',
    },
  ];
}
