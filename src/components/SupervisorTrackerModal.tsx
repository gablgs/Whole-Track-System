import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { ClockSession, ScheduledShiftRow, WorkerConfirmation } from '../types';
import {
  calcHours,
} from '../utils/geo';
import {
  getAllClockInsForEvent,
  getConfirmationsForEvent,
  saveClockSessionsForWorker,
} from '../services/firebase';
import { X, RefreshCw, FileSpreadsheet, Lock, Clock, CheckCircle2, AlertTriangle, Edit3, Trash2 } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  scheduledRows: ScheduledShiftRow[];
}

export function SupervisorTrackerModal({ isOpen, onClose, eventId, scheduledRows }: Props) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const [activeTab, setActiveTab] = useState<'confirmations' | 'clock'>('confirmations');
  const [dayFilter, setDayFilter] = useState('All');
  const [clockStatusFilter, setClockStatusFilter] = useState<'active' | 'needsReview' | 'inactive' | 'all'>('active');

  const [confirmations, setConfirmations] = useState<Record<string, WorkerConfirmation>>({});
  const [clockData, setClockData] = useState<Record<string, ClockSession[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Editing session state
  const [editingSession, setEditingSession] = useState<{
    workerName: string;
    index: number;
    clockIn: string;
    clockOut: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      loadData();
    }
  }, [isOpen, isAuthenticated, eventId]);

  if (!isOpen) return null;

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.trim() === '0327') {
      setIsAuthenticated(true);
      setPinError('');
    } else {
      setPinError('Incorrect PIN. Enter 0327.');
      setPinInput('');
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [conf, clk] = await Promise.all([
        getConfirmationsForEvent(eventId),
        getAllClockInsForEvent(eventId),
      ]);
      setConfirmations(conf);
      setClockData(clk);
      setLastRefreshed(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportExcel = () => {
    try {
      const detailRows: Record<string, unknown>[] = [];
      Object.keys(clockData).sort().forEach((name) => {
        const sessions = clockData[name] || [];
        sessions.forEach((session) => {
          const inDate = session.clockIn ? new Date(session.clockIn) : null;
          const outDate = session.clockOut ? new Date(session.clockOut) : null;
          const hrs = inDate && outDate ? Number(((outDate.getTime() - inDate.getTime()) / 3600000).toFixed(2)) : '';

          detailRows.push({
            Event_ID: eventId,
            Worker_Name: name,
            Day: session.day || '',
            Role: session.shiftRole || '',
            Scheduled_Time: session.scheduledTime || '',
            Clock_In: inDate ? inDate.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false }) : '',
            Clock_Out: outDate ? outDate.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false }) : '',
            Hours_Worked: hrs,
            Status: session.needsReview ? 'Needs Review' : session.clockOut ? 'Completed' : 'Open',
            Needs_Review: session.needsReview ? 'Yes' : 'No',
            Auto_Closed_Reason: session.autoClosedReason || '',
          });
        });
      });

      if (!detailRows.length) {
        alert('No clock-in records found to export.');
        return;
      }

      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet(detailRows);
      XLSX.utils.book_append_sheet(workbook, sheet, 'All Sessions');

      // Summary sheet
      const summaryMap = new Map<string, { Worker_Name: string; Role: string; Completed_Shifts: number; Total_Hours: number }>();
      detailRows.forEach((r) => {
        const key = `${r.Worker_Name}||${r.Role}`;
        if (!summaryMap.has(key)) {
          summaryMap.set(key, {
            Worker_Name: String(r.Worker_Name),
            Role: String(r.Role || 'General'),
            Completed_Shifts: 0,
            Total_Hours: 0,
          });
        }
        if (r.Status === 'Completed') {
          const curr = summaryMap.get(key)!;
          curr.Completed_Shifts += 1;
          curr.Total_Hours = Number((curr.Total_Hours + Number(r.Hours_Worked || 0)).toFixed(2));
        }
      });

      const summarySheet = XLSX.utils.json_to_sheet(Array.from(summaryMap.values()));
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

      XLSX.writeFile(workbook, `${eventId}_payroll_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('Could not export Excel file.');
    }
  };

  const handleDeleteSession = async (workerName: string, sessionIdx: number) => {
    if (!confirm(`Delete this session for ${workerName}?`)) return;
    const current = [...(clockData[workerName] || [])];
    current.splice(sessionIdx, 1);
    await saveClockSessionsForWorker(eventId, workerName, current);
    setClockData({ ...clockData, [workerName]: current });
  };

  const handleSaveEditedSession = async () => {
    if (!editingSession) return;
    const { workerName, index, clockIn, clockOut } = editingSession;
    if (!clockIn) {
      alert('Clock-in time is required.');
      return;
    }
    const current = [...(clockData[workerName] || [])];
    if (!current[index]) return;

    current[index] = {
      ...current[index],
      clockIn: new Date(clockIn).toISOString(),
      clockOut: clockOut ? new Date(clockOut).toISOString() : null,
      needsReview: false,
      reviewedAt: new Date().toISOString(),
      reviewNote: 'Audited by supervisor',
    };

    await saveClockSessionsForWorker(eventId, workerName, current);
    setClockData({ ...clockData, [workerName]: current });
    setEditingSession(null);
  };

  const uniqueDays = ['All', ...new Set(scheduledRows.map((s) => s.day).filter(Boolean))];

  // PIN Gate View
  if (!isAuthenticated) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/70 backdrop-blur-xs">
        <div className="w-full max-w-xs p-6 bg-white rounded-2xl shadow-2xl border border-stone-200">
          <div className="flex items-center justify-center w-12 h-12 mb-4 mx-auto rounded-full bg-rose-100 text-rose-700">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-center text-stone-900 mb-1">Supervisor Access</h3>
          <p className="text-xs text-center text-stone-500 mb-4">Enter your 4-digit supervisor PIN (default: 0327)</p>

          <form onSubmit={handlePinSubmit} className="flex flex-col gap-3">
            <input
              type="password"
              maxLength={6}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="••••"
              autoFocus
              className="w-full text-center text-2xl tracking-widest font-mono py-2.5 px-3 border border-stone-300 rounded-xl focus:border-rose-700 focus:outline-hidden"
            />
            {pinError && <p className="text-xs text-center text-rose-600 font-medium">{pinError}</p>}
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 text-sm font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 text-sm font-semibold rounded-lg bg-rose-700 hover:bg-rose-800 text-white shadow-xs transition-colors"
              >
                Enter
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Active clocked-in workers count
  const activeWorkingCount = Object.values(clockData).reduce((sum, list) => {
    return sum + list.filter((s) => s.clockIn && !s.clockOut).length;
  }, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-stone-950/70 backdrop-blur-xs">
      <div className="w-full max-w-4xl h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden">
        {/* Header */}
        <div className="bg-stone-900 text-white p-4 flex flex-wrap gap-3 items-center justify-between border-b border-stone-800">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight">Supervisor Dashboard</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-stone-800 text-rose-300 border border-stone-700">
                {eventId}
              </span>
            </div>
            <span className="text-xs text-stone-400">
              Refreshed {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={isLoading}
              className="p-1.5 sm:px-3 sm:py-1.5 rounded-lg border border-stone-700 hover:border-stone-500 text-xs font-semibold text-stone-300 hover:text-white flex items-center gap-1.5 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={handleExportExcel}
              className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-xs font-semibold text-white flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export Excel</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-stone-950 border-b border-stone-800 px-4">
          <button
            onClick={() => setActiveTab('confirmations')}
            className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'confirmations'
                ? 'border-rose-600 text-white'
                : 'border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Confirmations</span>
            <span className="px-1.5 py-0.2 rounded-full text-2xs bg-stone-800 font-mono">
              {Object.keys(confirmations).length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('clock')}
            className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'clock'
                ? 'border-rose-600 text-white'
                : 'border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Clock In / Out</span>
            <span className="px-1.5 py-0.2 rounded-full text-2xs bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
              {activeWorkingCount} active
            </span>
          </button>
        </div>

        {/* Body content */}
        <div className="flex-1 overflow-y-auto p-4 bg-stone-50">
          {/* Day filters */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {uniqueDays.map((d) => (
              <button
                key={d}
                onClick={() => setDayFilter(d)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  dayFilter === d
                    ? 'bg-rose-700 text-white font-semibold'
                    : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-100'
                }`}
              >
                {d.replace(/,\s+\w+\s+(\d+)/, ' $1')}
              </button>
            ))}
          </div>

          {activeTab === 'confirmations' ? (
            /* Confirmations Tab */
            <div className="space-y-2">
              {Object.keys(confirmations).length === 0 ? (
                <div className="p-8 text-center text-sm text-stone-500 bg-white rounded-xl border border-stone-200">
                  No shift confirmations logged for this event yet.
                </div>
              ) : (
                Object.entries(confirmations)
                  .filter(([, c]) => dayFilter === 'All' || c.shifts.some((s) => s.day === dayFilter))
                  .map(([name, c]) => (
                    <div key={name} className="p-3.5 bg-white rounded-xl border border-stone-200 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-stone-900">{name}</span>
                        <span className="text-2xs font-mono text-stone-400">
                          {new Date(c.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {c.shifts.map((s, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded text-2xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200"
                          >
                            {s.day.split(',')[0]} {s.time} · {s.role}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
              )}
            </div>
          ) : (
            /* Clock In / Out Tab */
            <div>
              {/* Status sub-filters */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {[
                  { key: 'active', label: 'Currently Working' },
                  { key: 'needsReview', label: 'Needs Review' },
                  { key: 'inactive', label: 'Not Working' },
                  { key: 'all', label: 'All Records' },
                ].map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setClockStatusFilter(f.key as any)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                      clockStatusFilter === f.key
                        ? 'bg-stone-900 text-white'
                        : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="space-y-2.5">
                {(() => {
                  const scheduledNames = [
                    ...new Set(scheduledRows.filter((s) => dayFilter === 'All' || s.day === dayFilter).map((s) => s.name)),
                  ];
                  const allNames = [...new Set([...scheduledNames, ...Object.keys(clockData)])];

                  const filtered = allNames.filter((name) => {
                    const sessions = clockData[name] || [];
                    const visibleSessions = dayFilter === 'All' ? sessions : sessions.filter((s) => s.day === dayFilter);
                    const hasActive = visibleSessions.some((s) => s.clockIn && !s.clockOut);
                    const hasReview = visibleSessions.some((s) => s.needsReview);

                    if (clockStatusFilter === 'active') return hasActive;
                    if (clockStatusFilter === 'needsReview') return hasReview;
                    if (clockStatusFilter === 'inactive') return !hasActive && !hasReview;
                    return true;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="p-8 text-center text-sm text-stone-500 bg-white rounded-xl border border-stone-200">
                        No workers match this status filter.
                      </div>
                    );
                  }

                  return filtered.map((name) => {
                    const sessions = clockData[name] || [];
                    const visibleSessions = dayFilter === 'All' ? sessions : sessions.filter((s) => s.day === dayFilter);
                    const hasActive = visibleSessions.some((s) => s.clockIn && !s.clockOut);
                    const hasReview = visibleSessions.some((s) => s.needsReview);

                    return (
                      <div key={name} className="p-3.5 bg-white rounded-xl border border-stone-200 shadow-2xs">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-sm text-stone-900">{name}</span>
                          <span
                            className={`text-2xs font-semibold px-2 py-0.5 rounded-full ${
                              hasReview
                                ? 'bg-rose-100 text-rose-800'
                                : hasActive
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-stone-100 text-stone-600'
                            }`}
                          >
                            {hasReview ? 'Needs Review' : hasActive ? 'Working Now' : 'Not Working'}
                          </span>
                        </div>

                        {visibleSessions.length > 0 && (
                          <div className="space-y-2 mt-2 pt-2 border-t border-stone-100">
                            {visibleSessions.map((session, sIdx) => {
                              const inTime = new Date(session.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                              const outTime = session.clockOut ? new Date(session.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
                              const hours = calcHours(session.clockIn, session.clockOut);

                              return (
                                <div key={sIdx} className="text-xs bg-stone-50 p-2.5 rounded-lg border border-stone-200 flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-col gap-0.5">
                                    <div className="font-medium text-stone-800">
                                      {session.day} {session.shiftRole ? `· ${session.shiftRole}` : ''}
                                    </div>
                                    <div className="font-mono text-stone-600">
                                      In: <span className="text-emerald-700 font-semibold">{inTime}</span> → Out:{' '}
                                      <span className="text-amber-700 font-semibold">{outTime || 'Active'}</span>
                                      {session.clockOut && ` (${hours} hrs)`}
                                    </div>
                                    {session.needsReview && (
                                      <div className="text-2xs text-rose-700 font-semibold flex items-center gap-1 mt-0.5">
                                        <AlertTriangle className="w-3 h-3" /> Auto-closed ({session.autoClosedReason || 'Max shift reached'})
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() =>
                                        setEditingSession({
                                          workerName: name,
                                          index: sIdx,
                                          clockIn: session.clockIn.slice(0, 16),
                                          clockOut: session.clockOut ? session.clockOut.slice(0, 16) : '',
                                        })
                                      }
                                      className="p-1.5 rounded-md bg-white border border-stone-200 text-stone-600 hover:text-stone-900 hover:border-stone-400"
                                      title="Edit session times"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteSession(name, sIdx)}
                                      className="p-1.5 rounded-md bg-white border border-stone-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300"
                                      title="Delete session"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Session Modal */}
      {editingSession && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-stone-950/80">
          <div className="w-full max-w-sm p-5 bg-white rounded-xl shadow-2xl border border-stone-200">
            <h4 className="text-sm font-bold text-stone-900 mb-1">Edit Session</h4>
            <p className="text-xs text-stone-500 mb-3">{editingSession.workerName}</p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Clock In (Date & Time)</label>
                <input
                  type="datetime-local"
                  value={editingSession.clockIn}
                  onChange={(e) => setEditingSession({ ...editingSession, clockIn: e.target.value })}
                  className="w-full p-2 border border-stone-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Clock Out (Leave blank if active)</label>
                <input
                  type="datetime-local"
                  value={editingSession.clockOut}
                  onChange={(e) => setEditingSession({ ...editingSession, clockOut: e.target.value })}
                  className="w-full p-2 border border-stone-300 rounded-lg font-mono"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setEditingSession(null)}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEditedSession}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-rose-700 hover:bg-rose-800 text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
