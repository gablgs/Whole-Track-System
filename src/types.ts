export type ShiftStatus = 'assigned' | 'confirmed' | 'clocked_in' | 'completed' | 'no_show';

export interface Shift {
  id: string;
  day: string;
  time: string;
  role: string;
  notes?: string;
  status: ShiftStatus;
}

export interface Worker {
  id: string;
  name: string;
  phone?: string;
  notes?: string;
  preferredRoles?: string[];
  shifts: Shift[];
}

export interface EventDetails {
  title: string;
  dateRange: string;
  eventYear: number;
  venue: string;
  clientName?: string;
  status: 'draft' | 'ready' | 'scheduled_live' | 'upcoming' | 'live' | 'completed' | 'archived';
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  billingRate: number;
  supervisor: string;
  phone: string;
  latitude: number;
  longitude: number;
  maxDistanceMeters: number;
  maxGpsAccuracy: number;
  earlyClockInMinutes: number;
  scheduledLiveAt?: string;
  meetingPoint?: string;
  dressCode?: string;
  notes?: string;
}

export interface EventConfigPayload {
  eventId?: string;
  event: EventDetails;
  workers: Worker[];
  updatedAt?: string;
}

export interface ClockSession {
  clockIn: string; // ISO
  clockOut?: string | null; // ISO
  day: string;
  shiftRole?: string;
  scheduledTime?: string;
  autoClosed?: boolean;
  needsReview?: boolean;
  autoClosedAt?: string | null;
  autoClosedReason?: string;
  originalClockIn?: string;
  reviewedAt?: string | null;
  reviewNote?: string;
}

export interface WorkerConfirmation {
  timestamp: string;
  shifts: {
    day: string;
    time: string;
    role: string;
  }[];
}

export interface ScheduledShiftRow {
  name: string;
  day: string;
  role: string;
  time: string;
}
