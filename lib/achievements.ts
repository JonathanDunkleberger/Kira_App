export interface Achievement {
  id: string;
  name: string;
  description: string;
}

export type CheckContext = {
  messagesCount: number;
  conversationCount: number;
  memoryCount: number;
  unlockedAchievements: string[];
};

export function checkAchievements(ctx: CheckContext): string[] {
  const { messagesCount, conversationCount, memoryCount, unlockedAchievements } = ctx;
  const newly: string[] = [];

  // Examples: tweak IDs to match your DB seed
  if (messagesCount >= 1 && !unlockedAchievements.includes('ICEBREAKER')) newly.push('ICEBREAKER');
  if (messagesCount >= 100 && !unlockedAchievements.includes('DEEP_THINKER')) newly.push('DEEP_THINKER');
  if (conversationCount >= 5 && !unlockedAchievements.includes('CHATTERBOX')) newly.push('CHATTERBOX');
  if (memoryCount >= 1 && !unlockedAchievements.includes('FIRST_MEMORY')) newly.push('FIRST_MEMORY');

  return newly;
}
