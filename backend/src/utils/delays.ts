import { getTodayTracker } from '../services/storage';

// Safe LinkedIn limits 2026
// NEVER increase connectionRequestsPerDay above 20 without testing on a fresh account
export const SAFE_LIMITS = {
  connectionRequestsPerDay: 20,
  messagesPerDay: 15,
  profileVisitsPerDay: 80,
  searchesPerDay: 20,

  betweenActions: { min: 15_000, max: 45_000 },
  betweenLeads: { min: 60_000, max: 180_000 },
  betweenSessions: { min: 3_600_000, max: 7_200_000 },

  // ⚠️ TESTING MODE: 24/7. For production change back to {start: 9, end: 18} and [1-5]
  workingHours: { start: 0, end: 24 },
  workingDays: [0, 1, 2, 3, 4, 5, 6] as const,
} as const;

export function isWithinWorkingHours(timezone = 'America/New_York'): boolean {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(now);
  const rawHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const hour = rawHour === 24 ? 0 : rawHour; // Intl returns 24 for midnight with hour12:false
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayNum = weekdayMap[weekday] ?? 0;

  const isWorkingDay = (SAFE_LIMITS.workingDays as readonly number[]).includes(dayNum);
  const isWorkingHour = hour >= SAFE_LIMITS.workingHours.start && hour < SAFE_LIMITS.workingHours.end;

  return isWorkingDay && isWorkingHour;
}

export interface DailyLimits {
  connectionsRemaining: number;
  messagesRemaining: number;
  profileVisitsRemaining: number;
  canSendConnection: boolean;
  canSendMessage: boolean;
  canVisitProfile: boolean;
}

export function getDailyLimits(): DailyLimits {
  const tracker = getTodayTracker();

  const connectionsRemaining = Math.max(0, SAFE_LIMITS.connectionRequestsPerDay - tracker.connections_sent);
  const messagesRemaining = Math.max(0, SAFE_LIMITS.messagesPerDay - tracker.messages_sent);
  const profileVisitsRemaining = Math.max(0, SAFE_LIMITS.profileVisitsPerDay - tracker.profiles_visited);

  return {
    connectionsRemaining,
    messagesRemaining,
    profileVisitsRemaining,
    canSendConnection: connectionsRemaining > 0,
    canSendMessage: messagesRemaining > 0,
    canVisitProfile: profileVisitsRemaining > 0,
  };
}

export function canPerformAction(action: 'connection' | 'message' | 'visit'): boolean {
  const limits = getDailyLimits();
  switch (action) {
    case 'connection': return limits.canSendConnection;
    case 'message': return limits.canSendMessage;
    case 'visit': return limits.canVisitProfile;
  }
}
