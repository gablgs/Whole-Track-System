import { ClockSession, EventConfigPayload, EventDetails, Worker, WorkerConfirmation } from '../types';

export const FIREBASE_ROOT = 'https://database-2943b-default-rtdb.firebaseio.com';
export const FIREBASE_CURRENT_ID_URL = `${FIREBASE_ROOT}/event_config/currentEventId.json`;
export const FIREBASE_EVENTS_URL = `${FIREBASE_ROOT}/event_config/events.json`;
export const FIREBASE_LEGACY_CURRENT_URL = `${FIREBASE_ROOT}/event_config/current.json`;
export const FIREBASE_CONFIRMATIONS_ROOT_URL = `${FIREBASE_ROOT}/confirmations`;
export const FIREBASE_CLOCKINS_ROOT_URL = `${FIREBASE_ROOT}/clockins`;

export const MAX_SHIFT_HOURS = 13;
export const MAX_SHIFT_MS = MAX_SHIFT_HOURS * 60 * 60 * 1000;

export const DEFAULT_EVENT_DETAILS: EventDetails = {
  title: 'The International Centre',
  dateRange: 'April 9–13',
  eventYear: 2026,
  venue: '6900 Airport Rd, Mississauga, ON L4V 1E8',
  clientName: 'Restaurants Canada',
  status: 'live',
  contactName: 'Gabriel Lagunes',
  contactEmail: '',
  contactPhone: '4379374198',
  billingRate: 28.5,
  supervisor: 'Gabriel Lagunes',
  phone: '4379374198',
  latitude: 43.7029,
  longitude: -79.638,
  maxDistanceMeters: 150,
  maxGpsAccuracy: 120,
  earlyClockInMinutes: 30,
  scheduledLiveAt: '',
  meetingPoint: 'Report to the Conference Centre entrance.',
  dressCode: 'Formal all black attire required.',
  notes: 'Arrive 10 minutes early.',
};

export function sanitizeEventId(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default_event';
}

export function fbKey(key: string): string {
  return encodeURIComponent(key).replace(/\./g, '%2E');
}

export function eventUrl(eventId: string): string {
  return `${FIREBASE_ROOT}/event_config/events/${sanitizeEventId(eventId)}.json`;
}

export function eventConfirmationsUrl(eventId: string): string {
  return `${FIREBASE_CONFIRMATIONS_ROOT_URL}/${sanitizeEventId(eventId)}.json`;
}

export function eventClockinsUrl(eventId: string): string {
  return `${FIREBASE_CLOCKINS_ROOT_URL}/${sanitizeEventId(eventId)}.json`;
}

export async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function writeJSON<T>(url: string, payload: T): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export function normalizeSessions(raw: unknown): ClockSession[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === 'object') list = Object.values(raw as Record<string, unknown>);

  return list
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof (s as Record<string, unknown>).clockIn === 'string')
    .map((s) => ({
      clockIn: String(s.clockIn),
      clockOut: s.clockOut ? String(s.clockOut) : null,
      day: String(s.day || ''),
      shiftRole: s.shiftRole ? String(s.shiftRole) : undefined,
      scheduledTime: s.scheduledTime ? String(s.scheduledTime) : undefined,
      autoClosed: Boolean(s.autoClosed),
      needsReview: Boolean(s.needsReview),
      autoClosedAt: s.autoClosedAt ? String(s.autoClosedAt) : null,
      autoClosedReason: s.autoClosedReason ? String(s.autoClosedReason) : undefined,
      originalClockIn: s.originalClockIn ? String(s.originalClockIn) : String(s.clockIn),
      reviewedAt: s.reviewedAt ? String(s.reviewedAt) : null,
      reviewNote: s.reviewNote ? String(s.reviewNote) : undefined,
    }))
    .sort((a, b) => new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime());
}

export function autoCloseExpiredSessions(sessions: ClockSession[]): { sessions: ClockSession[]; changed: boolean } {
  const now = Date.now();
  let changed = false;
  const updated = sessions.map((session) => {
    if (session.clockIn && !session.clockOut) {
      const clockInMs = new Date(session.clockIn).getTime();
      if (Number.isFinite(clockInMs) && now - clockInMs >= MAX_SHIFT_MS) {
        changed = true;
        return {
          ...session,
          clockOut: new Date(clockInMs + MAX_SHIFT_MS).toISOString(),
          autoClosed: true,
          needsReview: true,
          autoClosedAt: new Date().toISOString(),
          autoClosedReason: `Auto clock-out after ${MAX_SHIFT_HOURS} hours`,
        };
      }
    }
    return session;
  });
  return { sessions: updated, changed };
}

export async function getLiveEventId(): Promise<string> {
  try {
    const raw = await fetchJSON<string>(FIREBASE_CURRENT_ID_URL);
    return sanitizeEventId(raw);
  } catch {
    return 'rc-show-apr-15-2026';
  }
}

export async function getEventConfig(eventId: string): Promise<EventConfigPayload | null> {
  const id = sanitizeEventId(eventId);
  try {
    const data = await fetchJSON<EventConfigPayload>(eventUrl(id));
    if (data && typeof data === 'object') return data;
  } catch (err) {
    console.warn(`Could not load event ${id}:`, err);
  }
  return null;
}

export async function getAllEvents(): Promise<Record<string, EventConfigPayload>> {
  try {
    const data = await fetchJSON<Record<string, EventConfigPayload>>(FIREBASE_EVENTS_URL);
    return data || {};
  } catch (err) {
    console.warn('Could not load events index:', err);
    return {};
  }
}

export async function getClockSessionsForWorker(eventId: string, workerName: string): Promise<ClockSession[]> {
  try {
    const url = `${FIREBASE_CLOCKINS_ROOT_URL}/${sanitizeEventId(eventId)}/${fbKey(workerName)}.json`;
    const data = await fetchJSON<unknown>(url);
    const sessions = normalizeSessions(data);
    const { sessions: updated, changed } = autoCloseExpiredSessions(sessions);
    if (changed) {
      await saveClockSessionsForWorker(eventId, workerName, updated);
    }
    return updated;
  } catch {
    return [];
  }
}

export async function saveClockSessionsForWorker(eventId: string, workerName: string, sessions: ClockSession[]): Promise<void> {
  const url = `${FIREBASE_CLOCKINS_ROOT_URL}/${sanitizeEventId(eventId)}/${fbKey(workerName)}.json`;
  await writeJSON(url, sessions);
}

export async function getAllClockInsForEvent(eventId: string): Promise<Record<string, ClockSession[]>> {
  try {
    const url = eventClockinsUrl(eventId);
    const raw = await fetchJSON<Record<string, unknown>>(url);
    if (!raw || typeof raw !== 'object') return {};
    const result: Record<string, ClockSession[]> = {};
    for (const [name, sess] of Object.entries(raw)) {
      result[name] = normalizeSessions(sess);
    }
    return result;
  } catch {
    return {};
  }
}

export async function getConfirmationsForEvent(eventId: string): Promise<Record<string, WorkerConfirmation>> {
  try {
    const url = eventConfirmationsUrl(eventId);
    const data = await fetchJSON<Record<string, WorkerConfirmation>>(url);
    return data || {};
  } catch {
    return {};
  }
}

export async function saveConfirmationForWorker(
  eventId: string,
  workerName: string,
  confirmation: WorkerConfirmation
): Promise<void> {
  const url = `${FIREBASE_CONFIRMATIONS_ROOT_URL}/${sanitizeEventId(eventId)}/${fbKey(workerName)}.json`;
  await writeJSON(url, confirmation);
}

export async function countActiveSessions(eventId: string): Promise<number> {
  const clockMap = await getAllClockInsForEvent(eventId);
  let count = 0;
  for (const sessions of Object.values(clockMap)) {
    count += sessions.filter((s) => s.clockIn && !s.clockOut).length;
  }
  return count;
}
