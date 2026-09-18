// Calculation and time utilities for geofencing and shift checks

export function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getCurrentPositionAsync(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      reject(new Error('Location services require a secure HTTPS page.'));
      return;
    }
    if (!navigator.geolocation) {
      reject(new Error('This device or browser does not support location services.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => {
        if (err && err.code === 1) {
          reject(new Error('Location permission was denied. Please allow GPS access to clock in.'));
        } else if (err && err.code === 2) {
          reject(new Error('Your position could not be determined. Move closer or turn on high accuracy.'));
        } else if (err && err.code === 3) {
          reject(new Error('Location check timed out. Please try again.'));
        } else {
          reject(new Error('Location check failed.'));
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

export function parseTimePart(part: string): number | null {
  const raw = String(part || '').trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ');
  if (!raw) return null;

  const matchAmPm = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (matchAmPm) {
    let hour = Number(matchAmPm[1]);
    const minute = Number(matchAmPm[2] || 0);
    const suffix = matchAmPm[3];
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (hour === 12) hour = 0;
    if (suffix === 'PM') hour += 12;
    return hour * 60 + minute;
  }

  const match24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hour = Number(match24[1]);
    const minute = Number(match24[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  }

  return null;
}

export function formatMinutesAsTimeLabel(totalMinutes: number): string {
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(minutesInDay / 60);
  const minute = minutesInDay % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function parseTimeRange(range: string): { start: number; end: number; label: string } | null {
  const normalized = String(range || '')
    .trim()
    .replace(/[–—]/g, '-')
    .replace(/\s+to\s+/i, ' - ')
    .replace(/\s+/g, ' ');
  const parts = normalized.split(/\s*-\s*/);
  if (parts.length !== 2) return null;
  const start = parseTimePart(parts[0]);
  const end = parseTimePart(parts[1]);
  if (start === null || end === null) return null;
  let adjustedEnd = end;
  if (adjustedEnd <= start) adjustedEnd += 24 * 60;
  return {
    start,
    end: adjustedEnd,
    label: `${formatMinutesAsTimeLabel(start)} - ${formatMinutesAsTimeLabel(adjustedEnd)}`,
  };
}

export function estimateShiftHours(range: string): number {
  const parsed = parseTimeRange(range);
  if (!parsed) return 0;
  return Number(((parsed.end - parsed.start) / 60).toFixed(2));
}

export function parseShiftDateTime(dayLabel: string, timeLabel: string, year = 2026): Date | null {
  if (!dayLabel || !timeLabel) return null;
  // Match e.g. "Thursday, April 9" or "April 9"
  const m = dayLabel.match(/(?:[A-Za-z]+,\s+)?([A-Za-z]+)\s+(\d{1,2})/);
  if (!m) return null;
  const [, monthName, dayNum] = m;
  
  // Extract the starting time string if it is a range "9:00 AM - 5:00 PM"
  const startTimePart = timeLabel.includes('-') ? timeLabel.split('-')[0].trim() : timeLabel.trim();
  const dt = new Date(`${monthName} ${dayNum}, ${year} ${startTimePart}`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function calcHours(inISO?: string | null, outISO?: string | null): string {
  if (!inISO || !outISO) return '?';
  const diff = (new Date(outISO).getTime() - new Date(inISO).getTime()) / 3600000;
  return diff > 0 ? diff.toFixed(2) : '0.00';
}
