import { cleanName, cleanStats, type LeaderboardStat } from './share';

/** Who may see your friends' data on your dashboard. */
export type FriendsVisibility = 'admin' | 'reader' | 'public';

/** settings.json `friends`: how you share with friends, and who sees theirs. */
export interface FriendsSettings {
  /** Your friends' data is theirs: only you see it unless you choose otherwise. */
  visible_to: FriendsVisibility;
  /** The name friends see you as. */
  share_name: string;
  /** The stats you put on friends' leaderboards; none until you opt in. */
  leaderboards: LeaderboardStat[];
  /** Whether other installations may ask to follow you (you still approve each one). */
  accept_follows: boolean;
}

export const DEFAULT_FRIENDS: FriendsSettings = {
  visible_to: 'admin',
  share_name: '',
  leaderboards: [],
  accept_follows: true,
};

export function toFriendsSettings(raw: unknown): FriendsSettings {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    visible_to: o.visible_to === 'reader' || o.visible_to === 'public' ? o.visible_to : 'admin',
    share_name: cleanName(o.share_name, ''),
    leaderboards: cleanStats(o.leaderboards),
    accept_follows: o.accept_follows !== false,
  };
}
