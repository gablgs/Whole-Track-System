import { useState, useEffect, useRef } from 'react';
import { ClockSession, EventDetails, ScheduledShiftRow, WorkerConfirmation } from '../types';
import {
  calcHours,
  getCurrentPositionAsync,
  getDistanceMeters,
  parseShiftDateTime,
} from '../utils/geo';
import {
  getClockSessionsForWorker,
  saveClockSessionsForWorker,
  getConfirmationsForEvent,
  saveConfirmationForWorker,
} from '../services/firebase';
import { WorksiteGuideModal } from './WorksiteGuideModal';
import { SupervisorTrackerModal } from './SupervisorTrackerModal';
import {
  Search,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  HelpCircle,
  AlertCircle,
  MessageSquare,
  Undo2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface Props {
  eventId: string;
  eventDetails: EventDetails;
  scheduledRows: ScheduledShiftRow[];
  onOpenAdminPanel?: () => void;
}

export function StaffPortal({ eventId, eventDetails, scheduledRows, onOpenAdminPanel }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);

  const [workerSessions, setWorkerSessions] = useState<ClockSession[]>([]);
  const [workerConfirmation, setWorkerConfirmation] = useState<WorkerConfirmation | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Undo countdown
  const [undoSecondsLeft, setUndoSecondsLeft] = useState<number>(0);
  const lastClockInIsoRef = useRef<string | null>(null);

  // Modals
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isSupervisorOpen, setIsSupervisorOpen] = useState(false);
  const [showInfoBanner, setShowInfoBanner] = useState(true);

  // Shift selection modal for clock in
  const [isShiftSelectModalOpen, setIsShiftSelectModalOpen] = useState(false);
  const [selectedShiftForClockIn, setSelectedShiftForClockIn] = useState<ScheduledShiftRow | null>(null);

  // Secret tap counter for supervisor dashboard (3 taps within 1.6s)
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleSecretTap = () => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, 1600);

    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      setIsSupervisorOpen(true);
    }
  };

  // Autocomplete search
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const allNames = [...new Set(scheduledRows.map((s) => s.name))];
    const matches = allNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 6);
    setSuggestions(matches);
  }, [searchQuery, scheduledRows]);

  // Load worker data when worker selected
  useEffect(() => {
    if (!selectedWorker) {
      setWorkerSessions([]);
      setWorkerConfirmation(null);
      setConfirmChecked(false);
      return;
    }

    const loadWorkerData = async () => {
      setIsProcessing(true);
      try {
        const [sessions, allConfs] = await Promise.all([
          getClockSessionsForWorker(eventId, selectedWorker),
          getConfirmationsForEvent(eventId),
        ]);
        setWorkerSessions(sessions);
        setWorkerConfirmation(allConfs[selectedWorker] || null);
      } catch (err) {
        console.error(err);
      } finally {
        setIsProcessing(false);
      }
    };

    loadWorkerData();
  }, [selectedWorker, eventId]);

  // Undo countdown timer
  useEffect(() => {
    if (undoSecondsLeft <= 0) return;
    const interval = setInterval(() => {
      setUndoSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [undoSecondsLeft]);

  const selectWorker = (name: string) => {
    setSelectedWorker(name);
    setSearchQuery(name);
    setSuggestions([]);
    setStatusMessage(null);
  };

  const currentWorkerShifts = selectedWorker
    ? scheduledRows.filter((s) => s.name === selectedWorker)
    : [];

  const shiftsByDay = currentWorkerShifts.reduce<Record<string, ScheduledShiftRow[]>>((acc, s) => {
    if (!acc[s.day]) acc[s.day] = [];
    acc[s.day].push(s);
    return acc;
  }, {});

  const activeSession = workerSessions.find((s) => s.clockIn && !s.clockOut);
  const closedSessions = workerSessions.filter((s) => s.clockOut);

  // Confirmation handler
  const handleConfirmShifts = async () => {
    if (!selectedWorker || !confirmChecked) return;
    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const conf: WorkerConfirmation = {
        timestamp: new Date().toISOString(),
        shifts: currentWorkerShifts.map((s) => ({ day: s.day, time: s.time, role: s.role })),
      };
      await saveConfirmationForWorker(eventId, selectedWorker, conf);
      setWorkerConfirmation(conf);
      setStatusMessage({ text: 'Upcoming shifts successfully confirmed!', type: 'success' });
    } catch (err) {
      console.error(err);
      setStatusMessage({ text: 'Could not save confirmation. Check your connection.', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Clock in initiation
  const handleOpenClockInModal = () => {
    if (!selectedWorker) return;
    setStatusMessage(null);

    // Filter available shifts
    const usedShifts = new Set(
      workerSessions
        .filter((s) => s.day && s.scheduledTime)
        .map((s) => `${s.day}||${s.scheduledTime}||${s.shiftRole}`)
    );

    const availableShifts = currentWorkerShifts.filter(
      (s) => !usedShifts.has(`${s.day}||${s.time}||${s.role}`)
    );

    if (availableShifts.length === 0) {
      setStatusMessage({ text: 'No remaining shifts available to clock in for.', type: 'info' });
      return;
    }

    // Pre-select the earliest shift
    setSelectedShiftForClockIn(availableShifts[0]);
    setIsShiftSelectModalOpen(true);
  };

  // Execute Clock In with GPS Verification & Time Window
  const executeClockIn = async () => {
    if (!selectedWorker || !selectedShiftForClockIn) return;
    setIsShiftSelectModalOpen(false);
    setIsProcessing(true);
    setStatusMessage(null);

    try {
      // 1. Time Check: Within earlyClockInMinutes before start
      const shiftDate = parseShiftDateTime(
        selectedShiftForClockIn.day,
        selectedShiftForClockIn.time,
        eventDetails.eventYear
      );

      if (shiftDate) {
        const earlyMinutes = eventDetails.earlyClockInMinutes || 30;
        const earliestTime = new Date(shiftDate.getTime() - earlyMinutes * 60000);
        const now = new Date();

        if (now < earliestTime) {
          throw new Error(
            `You can only clock in within ${earlyMinutes} minutes of your shift start (${earliestTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).`
          );
        }
      }

      // 2. Location Check (Geofence)
      const pos = await getCurrentPositionAsync();
      const { latitude, longitude, accuracy } = pos.coords;

      const maxAcc = eventDetails.maxGpsAccuracy || 120;
      if (accuracy > maxAcc) {
        throw new Error(
          `GPS signal accuracy is too low (±${Math.round(accuracy)}m). Please move closer or wait for a clearer signal.`
        );
      }

      const dist = getDistanceMeters(
        latitude,
        longitude,
        eventDetails.latitude,
        eventDetails.longitude
      );

      const maxDist = eventDetails.maxDistanceMeters || 150;
      if (dist > maxDist) {
        throw new Error(
          `You are approximately ${Math.round(dist)}m away from the venue. You must be within ${maxDist}m of ${eventDetails.venue} to clock in.`
        );
      }

      // 3. Save Session
      const nowISO = new Date().toISOString();
      const newSession: ClockSession = {
        clockIn: nowISO,
        clockOut: null,
        day: selectedShiftForClockIn.day,
        shiftRole: selectedShiftForClockIn.role,
        scheduledTime: selectedShiftForClockIn.time,
        originalClockIn: nowISO,
      };

      const updated = [...workerSessions, newSession];
      await saveClockSessionsForWorker(eventId, selectedWorker, updated);
      setWorkerSessions(updated);

      lastClockInIsoRef.current = nowISO;
      setUndoSecondsLeft(10);
      setStatusMessage({ text: 'Clocked in successfully!', type: 'success' });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ text: err.message || 'Could not clock in.', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Clock Out
  const handleClockOut = async () => {
    if (!selectedWorker || !activeSession) return;
    setIsProcessing(true);
    setStatusMessage(null);

    try {
      const nowISO = new Date().toISOString();
      const updated = workerSessions.map((s) => {
        if (s.clockIn === activeSession.clockIn && !s.clockOut) {
          return { ...s, clockOut: nowISO };
        }
        return s;
      });

      await saveClockSessionsForWorker(eventId, selectedWorker, updated);
      setWorkerSessions(updated);
      setUndoSecondsLeft(0);
      setStatusMessage({ text: 'Clocked out successfully. Thank you for your work!', type: 'success' });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ text: 'Could not clock out. Check your connection.', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Accidental Undo
  const handleUndoClockIn = async () => {
    if (!selectedWorker || !lastClockInIsoRef.current) return;
    setIsProcessing(true);
    try {
      const updated = workerSessions.filter((s) => s.clockIn !== lastClockInIsoRef.current);
      await saveClockSessionsForWorker(eventId, selectedWorker, updated);
      setWorkerSessions(updated);
      setUndoSecondsLeft(0);
      lastClockInIsoRef.current = null;
      setStatusMessage({ text: 'Clock-in reverted.', type: 'info' });
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col items-center">
      {/* Red Header matching mobile artifact */}
      <header className="w-full bg-rose-800 text-white relative px-5 py-4 shadow-md">
        {/* Invisible Secret Tap for Supervisor */}
        <div
          onClick={handleSecretTap}
          className="absolute top-0 left-0 w-16 h-16 cursor-default z-20"
          title="Supervisory Area"
        />

        <div className="max-w-md mx-auto flex justify-between items-start">
          <div>
            <h1 className="text-lg font-bold tracking-tight">{eventDetails.title}</h1>
            <p className="text-xs text-rose-100/80 mt-0.5">Staff Schedule · {eventDetails.dateRange}</p>
          </div>
          <div className="text-right text-xs text-rose-100/90">
            <div>Supervisor: {eventDetails.supervisor}</div>
            <a href={`tel:${eventDetails.phone}`} className="underline font-mono">
              {eventDetails.phone}
            </a>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-md px-4 py-5 flex flex-col gap-4">
        {/* Search box */}
        <div className="relative">
          <div className="relative flex items-center">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type your name to find your shifts…"
              className="w-full pl-10 pr-4 py-3 bg-white border border-stone-300 rounded-xl text-stone-900 placeholder:text-stone-400 focus:outline-hidden focus:border-rose-700 shadow-2xs text-sm"
            />
            <Search className="absolute left-3.5 w-4 h-4 text-stone-400" />
          </div>

          {/* Autocomplete suggestions */}
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-30 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg overflow-hidden">
              {suggestions.map((name) => (
                <button
                  key={name}
                  onClick={() => selectWorker(name)}
                  className="w-full text-left px-4 py-2.5 text-sm text-stone-800 hover:bg-rose-50 hover:text-rose-900 border-b border-stone-100 last:border-b-0 transition-colors"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status alert message */}
        {statusMessage && (
          <div
            className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : statusMessage.type === 'error'
                ? 'bg-rose-50 text-rose-800 border border-rose-200'
                : 'bg-stone-200 text-stone-800'
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Selected Worker View */}
        {selectedWorker && (
          <div className="flex flex-col gap-3">
            <h2 className="text-xl font-bold text-stone-900 tracking-tight">{selectedWorker}</h2>

            {/* Shift cards grouped by day */}
            <div className="space-y-3">
              {Object.keys(shiftsByDay).length === 0 ? (
                <div className="p-4 bg-white rounded-xl border border-stone-200 text-center text-xs text-stone-500">
                  No shifts found for {selectedWorker}.
                </div>
              ) : (
                Object.entries(shiftsByDay).map(([day, shifts]) => (
                  <div key={day}>
                    <div className="text-2xs uppercase tracking-wider font-mono text-stone-500 font-semibold mb-1">
                      {day}
                    </div>
                    <div className="bg-white rounded-xl border border-stone-200 shadow-2xs divide-y divide-stone-100 overflow-hidden">
                      {shifts.map((s, idx) => (
                        <div key={idx} className="p-3 flex justify-between items-center text-sm">
                          <span className="font-medium text-stone-800">{s.role}</span>
                          <span className="font-mono text-xs font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
                            {s.time}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Shift Confirmation Section */}
            {workerConfirmation ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Shifts confirmed on{' '}
                  {new Date(workerConfirmation.timestamp).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ) : (
              <div className="p-3.5 bg-white border border-stone-200 rounded-xl space-y-2.5">
                <label className="flex items-start gap-2.5 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded text-rose-700 focus:ring-rose-600"
                  />
                  <span>I've reviewed my upcoming shifts and confirm I will attend.</span>
                </label>
                <button
                  onClick={handleConfirmShifts}
                  disabled={!confirmChecked || isProcessing}
                  className="w-full py-2.5 px-4 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition-colors"
                >
                  {isProcessing ? 'Saving…' : 'Confirm Attendance'}
                </button>
              </div>
            )}

            {/* Time Tracking / Clock-In / Clock-Out */}
            <div className="p-4 bg-white border border-stone-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-stone-700">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-rose-700" /> Time Tracking (GPS Geofenced)
                </span>
                {activeSession ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-2xs font-bold">
                    Clocked In
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 text-2xs">
                    Not Clocked In
                  </span>
                )}
              </div>

              {activeSession ? (
                <div className="space-y-2.5">
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                    <div>
                      Working shift: <strong>{activeSession.day}</strong> ({activeSession.shiftRole})
                    </div>
                    <div className="font-mono text-2xs text-amber-700 mt-1">
                      Clocked in at:{' '}
                      {new Date(activeSession.clockIn).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>

                  {undoSecondsLeft > 0 && (
                    <button
                      onClick={handleUndoClockIn}
                      className="w-full py-2 px-3 bg-stone-100 hover:bg-stone-200 border border-stone-300 rounded-lg text-xs font-semibold text-stone-700 flex items-center justify-center gap-1.5"
                    >
                      <Undo2 className="w-3.5 h-3.5" /> Undo accidental clock-in ({undoSecondsLeft}s)
                    </button>
                  )}

                  <button
                    onClick={handleClockOut}
                    disabled={isProcessing}
                    className="w-full py-3 px-4 bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm rounded-lg shadow-xs transition-colors"
                  >
                    ⏸ Clock Out
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleOpenClockInModal}
                  disabled={isProcessing}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-lg shadow-xs transition-colors"
                >
                  ⏵ Select Shift to Clock In
                </button>
              )}

              {/* Previous Completed Sessions */}
              {closedSessions.length > 0 && (
                <div className="pt-2 border-t border-stone-100 space-y-1.5">
                  <div className="text-2xs font-mono font-semibold uppercase text-stone-400">Past Sessions</div>
                  {closedSessions.map((cs, idx) => (
                    <div key={idx} className="text-xs text-stone-600 flex justify-between bg-stone-50 p-2 rounded">
                      <span>{cs.day}</span>
                      <span className="font-mono font-semibold text-stone-800">
                        {calcHours(cs.clockIn, cs.clockOut)} hrs
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Direct SMS link to Supervisor */}
            <a
              href={`sms:${eventDetails.phone}?body=Hi ${eventDetails.supervisor}, this is ${selectedWorker}. I have a question regarding my shifts for ${eventDetails.title}.`}
              className="flex items-center justify-center gap-2 p-3 bg-white border border-stone-300 hover:bg-stone-50 rounded-xl text-xs font-semibold text-rose-800 transition-colors shadow-2xs"
            >
              <MessageSquare className="w-4 h-4" /> Message Supervisor ({eventDetails.supervisor})
            </a>
          </div>
        )}

        {/* Venue Information Box */}
        <div className="p-4 bg-white border border-stone-200 rounded-xl shadow-2xs flex items-start gap-3">
          <MapPin className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
          <div className="text-xs">
            <div className="text-stone-500 font-medium">Worksite Venue</div>
            <div className="text-stone-900 font-semibold mt-0.5">{eventDetails.venue}</div>
          </div>
        </div>

        {/* Worksite Guide Button */}
        <button
          onClick={() => setIsGuideOpen(true)}
          className="w-full py-3 px-4 bg-white border-1.5 border-rose-700 text-rose-800 hover:bg-rose-50 font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-2xs transition-colors"
        >
          <HelpCircle className="w-4 h-4" /> New here? View worksite arrival guide
        </button>

        {/* Collapsible Worksite Details Banner */}
        <div className="bg-white border border-stone-200 rounded-xl shadow-2xs overflow-hidden">
          <button
            onClick={() => setShowInfoBanner(!showInfoBanner)}
            className="w-full p-3.5 flex justify-between items-center text-xs font-bold text-stone-800 bg-stone-50 border-b border-stone-100"
          >
            <span>Worksite Protocols & Instructions</span>
            {showInfoBanner ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showInfoBanner && (
            <div className="p-4 space-y-3 text-xs text-stone-600">
              <div>
                <strong className="text-stone-900 block mb-0.5">Meeting Point</strong>
                {eventDetails.meetingPoint || 'Report to the Conference Centre entrance.'}
              </div>
              <div className="pt-2 border-t border-stone-100">
                <strong className="text-stone-900 block mb-0.5">Dress Code</strong>
                {eventDetails.dressCode || 'Formal all black attire required.'}
              </div>
              <div className="pt-2 border-t border-stone-100">
                <strong className="text-stone-900 block mb-0.5">Supervisor Contact</strong>
                {eventDetails.supervisor} · {eventDetails.phone}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Clock-In Shift Selection Dialog */}
      {isShiftSelectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/70">
          <div className="w-full max-w-sm p-5 bg-white rounded-2xl shadow-2xl border border-stone-200">
            <h3 className="text-base font-bold text-stone-900 mb-1">Select Shift to Clock In</h3>
            <p className="text-xs text-stone-500 mb-3">
              Choose the shift you are starting now. Your location must be within {eventDetails.maxDistanceMeters}m of the venue.
            </p>

            <div className="space-y-2 mb-4 max-h-56 overflow-y-auto">
              {currentWorkerShifts.map((s, idx) => {
                const isSelected =
                  selectedShiftForClockIn?.day === s.day &&
                  selectedShiftForClockIn?.time === s.time &&
                  selectedShiftForClockIn?.role === s.role;

                return (
                  <label
                    key={idx}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-rose-700 bg-rose-50/50'
                        : 'border-stone-200 bg-white hover:bg-stone-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="shift_selection"
                      checked={isSelected}
                      onChange={() => setSelectedShiftForClockIn(s)}
                      className="mt-0.5 text-rose-700 focus:ring-rose-600"
                    />
                    <div>
                      <div className="font-bold text-stone-900">{s.day}</div>
                      <div className="text-stone-600 mt-0.5">
                        {s.time} · <span className="font-semibold">{s.role}</span>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setIsShiftSelectModalOpen(false)}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700"
              >
                Cancel
              </button>
              <button
                onClick={executeClockIn}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-rose-700 hover:bg-rose-800 text-white shadow-xs"
              >
                Confirm & Clock In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* First Time Worksite Arrival Guide Modal */}
      <WorksiteGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        venueTitle={eventDetails.title}
        supervisorName={eventDetails.supervisor}
        dressCode={eventDetails.dressCode || ''}
      />

      {/* Supervisor Tracker Modal (PIN Protected) */}
      <SupervisorTrackerModal
        isOpen={isSupervisorOpen}
        onClose={() => setIsSupervisorOpen(false)}
        onOpenAdminPanel={onOpenAdminPanel}
        eventId={eventId}
        scheduledRows={scheduledRows}
      />
    </div>
  );
}
