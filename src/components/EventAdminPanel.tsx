import { useState, useEffect } from 'react';
import { EventConfigPayload, EventDetails, Shift, ShiftStatus, Worker } from '../types';
import {
  countActiveSessions,
  getAllEvents,
  getEventConfig,
  sanitizeEventId,
  writeJSON,
  eventUrl,
  FIREBASE_CURRENT_ID_URL,
} from '../services/firebase';
import { estimateShiftHours, parseTimeRange } from '../utils/geo';
import {
  Save,
  Radio,
  Plus,
  Copy,
  Trash2,
  Users,
  Calendar,
  AlertTriangle,
  Download,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

interface Props {
  liveEventId: string;
  onLiveEventChanged: (newEventId: string) => void;
  initialConfig: EventConfigPayload;
}

export function EventAdminPanel({ liveEventId, onLiveEventChanged, initialConfig }: Props) {
  const [currentId, setCurrentId] = useState(initialConfig.eventId || 'rc-show-apr-15-2026');
  const [eventData, setEventData] = useState<EventDetails>(initialConfig.event);
  const [workers, setWorkers] = useState<Worker[]>(initialConfig.workers);
  const [savedEvents, setSavedEvents] = useState<Record<string, EventConfigPayload>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [statusNotice, setStatusNotice] = useState<{ text: string; isError: boolean } | null>(null);

  // Filters & Search
  const [workerSearch, setWorkerSearch] = useState('');
  const [workerRoleFilter, setWorkerRoleFilter] = useState('');
  const [shiftSearch, setShiftSearch] = useState('');
  const [shiftDayFilter, setShiftDayFilter] = useState('');
  const [shiftStatusFilter, setShiftStatusFilter] = useState('');
  const [shiftViewMode, setShiftViewMode] = useState<'table' | 'grouped'>('table');

  // Modals
  const [isWorkerModalOpen, setIsWorkerModalOpen] = useState(false);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [workerForm, setWorkerForm] = useState({ name: '', phone: '', preferredRoles: '', notes: '' });

  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<{ workerId: string; shiftIndex: number } | null>(null);
  const [shiftForm, setShiftForm] = useState({ workerId: '', day: '', time: '', role: '', status: 'assigned' as ShiftStatus, notes: '' });

  const [isBulkWorkersModalOpen, setIsBulkWorkersModalOpen] = useState(false);
  const [bulkWorkersText, setBulkWorkersText] = useState('');

  const [isBulkAssignModalOpen, setIsBulkAssignModalOpen] = useState(false);
  const [bulkAssignForm, setBulkAssignForm] = useState({
    day: '',
    time: '',
    role: '',
    status: 'assigned' as ShiftStatus,
    notes: '',
    selectedWorkerIds: [] as string[],
  });

  useEffect(() => {
    loadEventsList();
  }, []);

  const loadEventsList = async () => {
    const list = await getAllEvents();
    setSavedEvents(list);
  };

  const handleLoadSelected = async (targetId: string) => {
    if (!targetId) return;
    setIsSaving(true);
    try {
      const data = await getEventConfig(targetId);
      if (data) {
        setCurrentId(targetId);
        setEventData(data.event);
        setWorkers(data.workers || []);
        setStatusNotice({ text: `Loaded event "${targetId}".`, isError: false });
      }
    } catch {
      setStatusNotice({ text: `Could not load event ${targetId}.`, isError: true });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEventOnly = async () => {
    const cleanId = sanitizeEventId(currentId);
    if (!cleanId) {
      alert('Please specify an Event ID.');
      return;
    }
    setIsSaving(true);
    setStatusNotice(null);
    try {
      const payload: EventConfigPayload = {
        eventId: cleanId,
        event: eventData,
        workers,
        updatedAt: new Date().toISOString(),
      };
      await writeJSON(eventUrl(cleanId), payload);
      await loadEventsList();
      setStatusNotice({ text: `Successfully saved event "${cleanId}".`, isError: false });
    } catch (err: any) {
      setStatusNotice({ text: `Save error: ${err.message}`, isError: true });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetLive = async (targetId?: string) => {
    const idToLive = sanitizeEventId(targetId || currentId);
    if (!idToLive) return;

    // Check active sessions on the currently live event
    if (liveEventId && liveEventId !== idToLive) {
      const activeCount = await countActiveSessions(liveEventId);
      if (activeCount > 0) {
        const proceed = confirm(
          `Notice: There are currently ${activeCount} active clock-in session(s) on "${liveEventId}".\n\nSwitching live now will point workers to "${idToLive}". Continue?`
        );
        if (!proceed) return;
      }
    }

    setIsSaving(true);
    try {
      // Save current event state first
      const payload: EventConfigPayload = {
        eventId: idToLive,
        event: { ...eventData, status: 'live' },
        workers,
        updatedAt: new Date().toISOString(),
      };
      await writeJSON(eventUrl(idToLive), payload);
      await writeJSON(FIREBASE_CURRENT_ID_URL, idToLive);

      onLiveEventChanged(idToLive);
      setEventData((prev) => ({ ...prev, status: 'live' }));
      await loadEventsList();
      setStatusNotice({ text: `Event "${idToLive}" is now LIVE for worker clock-ins!`, isError: false });
    } catch (err: any) {
      setStatusNotice({ text: `Could not switch live: ${err.message}`, isError: true });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEvent = async () => {
    const cleanId = sanitizeEventId(currentId);
    if (cleanId === liveEventId) {
      alert('Cannot delete the currently LIVE event. Switch another event live first.');
      return;
    }
    const typed = prompt(`Delete event "${cleanId}" permanently? Type DELETE to confirm.`);
    if (typed !== 'DELETE') return;

    setIsSaving(true);
    try {
      await writeJSON(eventUrl(cleanId), null);
      await loadEventsList();
      setStatusNotice({ text: `Event "${cleanId}" was deleted.`, isError: false });
    } catch (err: any) {
      setStatusNotice({ text: err.message, isError: true });
    } finally {
      setIsSaving(false);
    }
  };

  // CSV Exports
  const exportCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const escape = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const csvContent = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportWorkers = () => {
    const headers = ['Event ID', 'Event Title', 'Worker Name', 'Phone', 'Preferred Roles', 'Shift Count', 'Notes'];
    const rows = workers.map((w) => [
      currentId,
      eventData.title,
      w.name,
      w.phone || '',
      (w.preferredRoles || []).join(' | '),
      w.shifts.length,
      w.notes || '',
    ]);
    exportCSV(`${currentId}_workers.csv`, headers, rows);
  };

  const handleExportShifts = () => {
    const headers = ['Event ID', 'Event Title', 'Worker Name', 'Day', 'Time', 'Role', 'Status', 'Estimated Hours', 'Notes'];
    const rows: (string | number)[][] = [];
    workers.forEach((w) => {
      w.shifts.forEach((s) => {
        rows.push([
          currentId,
          eventData.title,
          w.name,
          s.day,
          s.time,
          s.role,
          s.status,
          estimateShiftHours(s.time),
          s.notes || '',
        ]);
      });
    });
    exportCSV(`${currentId}_shifts.csv`, headers, rows);
  };

  const handleExportInvoice = () => {
    const headers = ['Event ID', 'Event Title', 'Client', 'Rate', 'Worker', 'Day', 'Time', 'Role', 'Hours', 'Line Total'];
    const rate = eventData.billingRate || 0;
    const rows: (string | number)[][] = [];
    workers.forEach((w) => {
      w.shifts.forEach((s) => {
        const hrs = estimateShiftHours(s.time);
        rows.push([
          currentId,
          eventData.title,
          eventData.clientName || '',
          rate.toFixed(2),
          w.name,
          s.day,
          s.time,
          s.role,
          hrs.toFixed(2),
          (hrs * rate).toFixed(2),
        ]);
      });
    });
    exportCSV(`${currentId}_invoice.csv`, headers, rows);
  };

  // Workers CRUD
  const handleSaveWorkerModal = () => {
    if (!workerForm.name.trim()) {
      alert('Worker name is required.');
      return;
    }
    const rolesList = workerForm.preferredRoles
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    if (editingWorkerId) {
      setWorkers(
        workers.map((w) =>
          w.id === editingWorkerId
            ? { ...w, name: workerForm.name.trim(), phone: workerForm.phone.trim(), preferredRoles: rolesList, notes: workerForm.notes.trim() }
            : w
        )
      );
    } else {
      const newWorker: Worker = {
        id: `w-${Date.now()}`,
        name: workerForm.name.trim(),
        phone: workerForm.phone.trim(),
        preferredRoles: rolesList,
        notes: workerForm.notes.trim(),
        shifts: [],
      };
      setWorkers([...workers, newWorker]);
    }
    setIsWorkerModalOpen(false);
  };

  const handleBulkAddWorkers = () => {
    const lines = bulkWorkersText.split('\n').map((l) => l.trim()).filter(Boolean);
    const existing = new Set(workers.map((w) => w.name.toLowerCase()));
    const created: Worker[] = [];

    lines.forEach((line, idx) => {
      const parts = line.split(',').map((p) => p.trim());
      const name = parts[0];
      if (!name || existing.has(name.toLowerCase())) return;
      existing.add(name.toLowerCase());

      const phone = parts[1] || '';
      const roles = (parts[2] || '').split('|').map((r) => r.trim()).filter(Boolean);
      const notes = parts.slice(3).join(', ');

      created.push({
        id: `w-bulk-${Date.now()}-${idx}`,
        name,
        phone,
        preferredRoles: roles,
        notes,
        shifts: [],
      });
    });

    setWorkers([...workers, ...created]);
    setIsBulkWorkersModalOpen(false);
    setBulkWorkersText('');
  };

  // Shifts CRUD
  const handleSaveShiftModal = () => {
    const { workerId, day, time, role, status, notes } = shiftForm;
    if (!workerId || !day || !time || !role) {
      alert('Worker, Day, Time, and Role are required.');
      return;
    }

    const targetWorker = workers.find((w) => w.id === workerId);
    if (!targetWorker) return;

    if (editingShift) {
      setWorkers(
        workers.map((w) => {
          if (w.id === editingShift.workerId) {
            const shiftsCopy = [...w.shifts];
            shiftsCopy[editingShift.shiftIndex] = {
              ...shiftsCopy[editingShift.shiftIndex],
              day,
              time,
              role,
              status,
              notes,
            };
            return { ...w, shifts: shiftsCopy };
          }
          return w;
        })
      );
    } else {
      const newShift: Shift = {
        id: `s-${Date.now()}`,
        day,
        time,
        role,
        status,
        notes,
      };
      setWorkers(
        workers.map((w) => (w.id === workerId ? { ...w, shifts: [...w.shifts, newShift] } : w))
      );
    }
    setIsShiftModalOpen(false);
  };

  const handleBulkAssignShifts = () => {
    const { day, time, role, status, notes, selectedWorkerIds } = bulkAssignForm;
    if (!day || !time || !role || !selectedWorkerIds.length) {
      alert('Day, Time, Role, and at least one worker are required.');
      return;
    }

    setWorkers(
      workers.map((w) => {
        if (selectedWorkerIds.includes(w.id)) {
          return {
            ...w,
            shifts: [
              ...w.shifts,
              { id: `s-bulk-${Date.now()}-${w.id}`, day, time, role, status, notes },
            ],
          };
        }
        return w;
      })
    );
    setIsBulkAssignModalOpen(false);
  };

  // Stats
  const totalShifts = workers.reduce((sum, w) => sum + w.shifts.length, 0);
  const totalHours = workers.reduce(
    (sum, w) => sum + w.shifts.reduce((sSum, s) => sSum + estimateShiftHours(s.time), 0),
    0
  );
  const totalRevenue = totalHours * (eventData.billingRate || 0);

  // Filtered workers
  const filteredWorkers = workers.filter((w) => {
    const matchQ =
      !workerSearch ||
      w.name.toLowerCase().includes(workerSearch.toLowerCase()) ||
      (w.phone && w.phone.includes(workerSearch));
    const matchRole =
      !workerRoleFilter ||
      (w.preferredRoles && w.preferredRoles.some((r) => r.toLowerCase() === workerRoleFilter.toLowerCase()));
    return matchQ && matchRole;
  });

  // Flat shifts for display
  const allFlatShifts = workers.flatMap((w) =>
    w.shifts.map((s, idx) => ({ ...s, workerId: w.id, workerName: w.name, shiftIndex: idx }))
  );

  const filteredShifts = allFlatShifts.filter((s) => {
    const matchQ =
      !shiftSearch ||
      s.workerName.toLowerCase().includes(shiftSearch.toLowerCase()) ||
      s.role.toLowerCase().includes(shiftSearch.toLowerCase());
    const matchDay = !shiftDayFilter || s.day === shiftDayFilter;
    const matchStatus = !shiftStatusFilter || s.status === shiftStatusFilter;
    return matchQ && matchDay && matchStatus;
  });

  const uniqueDays = [...new Set(allFlatShifts.map((s) => s.day).filter(Boolean))];

  return (
    <div className="w-full max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Top Bar: Event Manager Switcher */}
      <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-sm flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-stone-900 tracking-tight">Event Admin Panel</h2>
            <span
              className={`text-2xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                currentId === liveEventId
                  ? 'bg-rose-100 text-rose-800 border border-rose-200'
                  : 'bg-stone-100 text-stone-600'
              }`}
            >
              {currentId === liveEventId ? 'Live Event' : 'Draft / Stored'}
            </span>
          </div>
          <p className="text-xs text-stone-500 mt-0.5">
            Multi-event management, shift scheduling, and Firebase synchronization.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={currentId}
            onChange={(e) => handleLoadSelected(e.target.value)}
            className="text-xs font-semibold px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl"
          >
            <option value="">Switch Event…</option>
            {Object.keys(savedEvents).map((id) => (
              <option key={id} value={id}>
                {id} {id === liveEventId ? '★ (LIVE)' : ''}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              const newId = `event-${Date.now().toString().slice(-6)}`;
              setCurrentId(newId);
              setEventData({ ...eventData, title: 'New Event', status: 'draft' });
              setWorkers([]);
            }}
            className="p-2 sm:px-3 sm:py-2 text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">New Blank</span>
          </button>

          <button
            onClick={handleSaveEventOnly}
            disabled={isSaving}
            className="px-3.5 py-2 text-xs font-semibold bg-stone-900 hover:bg-stone-800 text-white rounded-xl flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <Save className="w-3.5 h-3.5" /> Save Event
          </button>

          <button
            onClick={() => handleSetLive()}
            disabled={isSaving}
            className="px-3.5 py-2 text-xs font-semibold bg-rose-700 hover:bg-rose-800 text-white rounded-xl flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <Radio className="w-3.5 h-3.5" /> Set Live for Workers
          </button>
        </div>
      </div>

      {statusNotice && (
        <div
          className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
            statusNotice.isError
              ? 'bg-rose-50 text-rose-800 border border-rose-200'
              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusNotice.text}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-white border border-stone-200 rounded-xl shadow-2xs">
          <div className="text-2xs uppercase tracking-wider font-mono text-stone-500 font-semibold">Total Workers</div>
          <div className="text-2xl font-black text-stone-900 mt-1">{workers.length}</div>
        </div>
        <div className="p-4 bg-white border border-stone-200 rounded-xl shadow-2xs">
          <div className="text-2xs uppercase tracking-wider font-mono text-stone-500 font-semibold">Total Shifts</div>
          <div className="text-2xl font-black text-stone-900 mt-1">{totalShifts}</div>
        </div>
        <div className="p-4 bg-white border border-stone-200 rounded-xl shadow-2xs">
          <div className="text-2xs uppercase tracking-wider font-mono text-stone-500 font-semibold">Estimated Hours</div>
          <div className="text-2xl font-black text-stone-900 mt-1">{totalHours.toFixed(1)} hrs</div>
        </div>
        <div className="p-4 bg-white border border-stone-200 rounded-xl shadow-2xs">
          <div className="text-2xs uppercase tracking-wider font-mono text-stone-500 font-semibold">Estimated Revenue</div>
          <div className="text-2xl font-black text-rose-700 mt-1">${totalRevenue.toFixed(2)}</div>
        </div>
      </div>

      {/* Event Details Form */}
      <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-sm space-y-4">
        <h3 className="text-base font-bold text-stone-900 border-b border-stone-100 pb-2">Event Parameters</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="block font-semibold text-stone-700 mb-1">Event ID (Firebase Key)</label>
            <input
              type="text"
              value={currentId}
              onChange={(e) => setCurrentId(e.target.value)}
              className="w-full p-2 border border-stone-300 rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="block font-semibold text-stone-700 mb-1">Event Title</label>
            <input
              type="text"
              value={eventData.title}
              onChange={(e) => setEventData({ ...eventData, title: e.target.value })}
              className="w-full p-2 border border-stone-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-semibold text-stone-700 mb-1">Date Range</label>
            <input
              type="text"
              value={eventData.dateRange}
              onChange={(e) => setEventData({ ...eventData, dateRange: e.target.value })}
              placeholder="e.g. April 9–13"
              className="w-full p-2 border border-stone-300 rounded-lg"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block font-semibold text-stone-700 mb-1">Venue Address</label>
            <input
              type="text"
              value={eventData.venue}
              onChange={(e) => setEventData({ ...eventData, venue: e.target.value })}
              className="w-full p-2 border border-stone-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-semibold text-stone-700 mb-1">Billing Rate ($/hr)</label>
            <input
              type="number"
              step="0.01"
              value={eventData.billingRate || 0}
              onChange={(e) => setEventData({ ...eventData, billingRate: parseFloat(e.target.value) || 0 })}
              className="w-full p-2 border border-stone-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-semibold text-stone-700 mb-1">Supervisor Name</label>
            <input
              type="text"
              value={eventData.supervisor}
              onChange={(e) => setEventData({ ...eventData, supervisor: e.target.value })}
              className="w-full p-2 border border-stone-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-semibold text-stone-700 mb-1">Supervisor Phone</label>
            <input
              type="text"
              value={eventData.phone}
              onChange={(e) => setEventData({ ...eventData, phone: e.target.value })}
              className="w-full p-2 border border-stone-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-semibold text-stone-700 mb-1">Clock-in Radius (meters)</label>
            <input
              type="number"
              value={eventData.maxDistanceMeters}
              onChange={(e) => setEventData({ ...eventData, maxDistanceMeters: parseInt(e.target.value) || 150 })}
              className="w-full p-2 border border-stone-300 rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* Workers Management */}
      <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-sm space-y-4">
        <div className="flex flex-wrap gap-2 justify-between items-center border-b border-stone-100 pb-3">
          <div>
            <h3 className="text-base font-bold text-stone-900">Workers Roster ({workers.length})</h3>
            <p className="text-xs text-stone-500">Add workers once and assign them across event shifts.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsBulkWorkersModalOpen(true)}
              className="px-3 py-1.5 text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg"
            >
              Bulk Add Workers
            </button>
            <button
              onClick={() => {
                setEditingWorkerId(null);
                setWorkerForm({ name: '', phone: '', preferredRoles: '', notes: '' });
                setIsWorkerModalOpen(true);
              }}
              className="px-3 py-1.5 text-xs font-semibold bg-rose-700 hover:bg-rose-800 text-white rounded-lg"
            >
              + Add Worker
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 text-xs">
          <input
            type="text"
            placeholder="Search worker name or phone…"
            value={workerSearch}
            onChange={(e) => setWorkerSearch(e.target.value)}
            className="p-2 border border-stone-300 rounded-lg min-w-[200px]"
          />
        </div>

        {/* Workers List */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                <th className="py-2.5 px-3">Name</th>
                <th className="py-2.5 px-3">Phone</th>
                <th className="py-2.5 px-3">Roles</th>
                <th className="py-2.5 px-3">Shifts</th>
                <th className="py-2.5 px-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredWorkers.map((w) => (
                <tr key={w.id} className="hover:bg-stone-50">
                  <td className="py-2.5 px-3 font-semibold text-stone-900">{w.name}</td>
                  <td className="py-2.5 px-3 text-stone-600 font-mono">{w.phone || '—'}</td>
                  <td className="py-2.5 px-3 text-stone-600">{(w.preferredRoles || []).join(', ') || '—'}</td>
                  <td className="py-2.5 px-3 font-bold text-stone-800">{w.shifts.length}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => {
                          setEditingWorkerId(w.id);
                          setWorkerForm({
                            name: w.name,
                            phone: w.phone || '',
                            preferredRoles: (w.preferredRoles || []).join(', '),
                            notes: w.notes || '',
                          });
                          setIsWorkerModalOpen(true);
                        }}
                        className="px-2 py-1 text-2xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-800 rounded"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Remove worker ${w.name}?`)) {
                            setWorkers(workers.filter((item) => item.id !== w.id));
                          }
                        }}
                        className="px-2 py-1 text-2xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 rounded"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Shifts Management */}
      <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-sm space-y-4">
        <div className="flex flex-wrap gap-2 justify-between items-center border-b border-stone-100 pb-3">
          <div>
            <h3 className="text-base font-bold text-stone-900">Shift Assignments ({allFlatShifts.length})</h3>
            <p className="text-xs text-stone-500">Assign workers to stations and track planned shifts.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setBulkAssignForm({
                  day: '',
                  time: '',
                  role: '',
                  status: 'assigned',
                  notes: '',
                  selectedWorkerIds: [],
                });
                setIsBulkAssignModalOpen(true);
              }}
              className="px-3 py-1.5 text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg"
            >
              Bulk Assign
            </button>
            <button
              onClick={() => {
                setEditingShift(null);
                setShiftForm({
                  workerId: workers[0]?.id || '',
                  day: '',
                  time: '',
                  role: '',
                  status: 'assigned',
                  notes: '',
                });
                setIsShiftModalOpen(true);
              }}
              className="px-3 py-1.5 text-xs font-semibold bg-rose-700 hover:bg-rose-800 text-white rounded-lg"
            >
              + Add Shift
            </button>
          </div>
        </div>

        {/* Shift filters */}
        <div className="flex flex-wrap gap-2 text-xs">
          <input
            type="text"
            placeholder="Search worker or role…"
            value={shiftSearch}
            onChange={(e) => setShiftSearch(e.target.value)}
            className="p-2 border border-stone-300 rounded-lg"
          />
          <select
            value={shiftDayFilter}
            onChange={(e) => setShiftDayFilter(e.target.value)}
            className="p-2 border border-stone-300 rounded-lg"
          >
            <option value="">All Days</option>
            {uniqueDays.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        {/* Shifts Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                <th className="py-2.5 px-3">Worker</th>
                <th className="py-2.5 px-3">Day</th>
                <th className="py-2.5 px-3">Time</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredShifts.map((s, idx) => (
                <tr key={idx} className="hover:bg-stone-50">
                  <td className="py-2.5 px-3 font-semibold text-stone-900">{s.workerName}</td>
                  <td className="py-2.5 px-3 text-stone-700">{s.day}</td>
                  <td className="py-2.5 px-3 font-mono text-rose-800 font-medium">{s.time}</td>
                  <td className="py-2.5 px-3 text-stone-700">{s.role}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-full text-2xs font-semibold bg-stone-100 text-stone-700">
                      {s.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <button
                      onClick={() => {
                        if (confirm(`Remove this shift for ${s.workerName}?`)) {
                          setWorkers(
                            workers.map((w) =>
                              w.id === s.workerId
                                ? { ...w, shifts: w.shifts.filter((_, sIdx) => sIdx !== s.shiftIndex) }
                                : w
                            )
                          );
                        }
                      }}
                      className="px-2 py-1 text-2xs font-semibold text-rose-700 hover:bg-rose-50 rounded"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Export Section */}
      <div className="p-5 bg-white border border-stone-200 rounded-2xl shadow-sm space-y-3">
        <h3 className="text-base font-bold text-stone-900">Exports & Snapshots</h3>
        <p className="text-xs text-stone-500">Generate CSV files for payroll, client billing, or event roster.</p>
        <div className="flex flex-wrap gap-2.5 pt-1">
          <button
            onClick={handleExportWorkers}
            className="px-3.5 py-2 text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Export Workers CSV
          </button>
          <button
            onClick={handleExportShifts}
            className="px-3.5 py-2 text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Export Shifts CSV
          </button>
          <button
            onClick={handleExportInvoice}
            className="px-3.5 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl flex items-center gap-1.5 shadow-xs"
          >
            <Download className="w-3.5 h-3.5" /> Export Invoice & Billing CSV
          </button>
        </div>
      </div>

      {/* Worker Modal */}
      {isWorkerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/70">
          <div className="w-full max-w-md p-5 bg-white rounded-2xl shadow-2xl border border-stone-200">
            <h3 className="text-base font-bold text-stone-900 mb-3">
              {editingWorkerId ? 'Edit Worker' : 'Add New Worker'}
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  value={workerForm.name}
                  onChange={(e) => setWorkerForm({ ...workerForm, name: e.target.value })}
                  className="w-full p-2 border border-stone-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={workerForm.phone}
                  onChange={(e) => setWorkerForm({ ...workerForm, phone: e.target.value })}
                  className="w-full p-2 border border-stone-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Preferred Roles (comma-separated)</label>
                <input
                  type="text"
                  value={workerForm.preferredRoles}
                  placeholder="Server, Bartender, Cleaner"
                  onChange={(e) => setWorkerForm({ ...workerForm, preferredRoles: e.target.value })}
                  className="w-full p-2 border border-stone-300 rounded-lg"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setIsWorkerModalOpen(false)}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveWorkerModal}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-rose-700 hover:bg-rose-800 text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Workers Modal */}
      {isBulkWorkersModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/70">
          <div className="w-full max-w-lg p-5 bg-white rounded-2xl shadow-2xl border border-stone-200">
            <h3 className="text-base font-bold text-stone-900 mb-1">Bulk Add Workers</h3>
            <p className="text-xs text-stone-500 mb-3">
              Paste one worker per line. Format: <code className="bg-stone-100 px-1 py-0.5 rounded font-mono">Name, Phone, Role1|Role2</code>
            </p>
            <textarea
              rows={8}
              value={bulkWorkersText}
              onChange={(e) => setBulkWorkersText(e.target.value)}
              placeholder="John Doe, 4161234567, Server|Bartender&#10;Jane Smith, 4169876543, Cleaner"
              className="w-full p-3 border border-stone-300 rounded-xl text-xs font-mono"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setIsBulkWorkersModalOpen(false)}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkAddWorkers}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-rose-700 hover:bg-rose-800 text-white"
              >
                Add Workers
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Assign Modal */}
      {isBulkAssignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/70">
          <div className="w-full max-w-lg p-5 bg-white rounded-2xl shadow-2xl border border-stone-200 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-stone-900 mb-1">Bulk Assign Shifts</h3>
            <p className="text-xs text-stone-500 mb-3">Select shift details and pick multiple workers to assign.</p>

            <div className="grid grid-cols-2 gap-3 text-xs mb-3">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Day</label>
                <input
                  type="text"
                  placeholder="Thursday, April 9"
                  value={bulkAssignForm.day}
                  onChange={(e) => setBulkAssignForm({ ...bulkAssignForm, day: e.target.value })}
                  className="w-full p-2 border border-stone-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Time</label>
                <input
                  type="text"
                  placeholder="10:00 AM - 6:00 PM"
                  value={bulkAssignForm.time}
                  onChange={(e) => setBulkAssignForm({ ...bulkAssignForm, time: e.target.value })}
                  className="w-full p-2 border border-stone-300 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-semibold text-stone-700 mb-1">Role</label>
                <input
                  type="text"
                  placeholder="Server"
                  value={bulkAssignForm.role}
                  onChange={(e) => setBulkAssignForm({ ...bulkAssignForm, role: e.target.value })}
                  className="w-full p-2 border border-stone-300 rounded-lg"
                />
              </div>
            </div>

            <div className="border border-stone-200 rounded-xl p-3 max-h-48 overflow-y-auto space-y-1.5 text-xs">
              <div className="font-semibold text-stone-700 mb-1">Select Workers:</div>
              {workers.map((w) => (
                <label key={w.id} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-stone-50 rounded">
                  <input
                    type="checkbox"
                    checked={bulkAssignForm.selectedWorkerIds.includes(w.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setBulkAssignForm({
                          ...bulkAssignForm,
                          selectedWorkerIds: [...bulkAssignForm.selectedWorkerIds, w.id],
                        });
                      } else {
                        setBulkAssignForm({
                          ...bulkAssignForm,
                          selectedWorkerIds: bulkAssignForm.selectedWorkerIds.filter((id) => id !== w.id),
                        });
                      }
                    }}
                    className="rounded text-rose-700"
                  />
                  <span>{w.name}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setIsBulkAssignModalOpen(false)}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkAssignShifts}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-rose-700 hover:bg-rose-800 text-white"
              >
                Assign to {bulkAssignForm.selectedWorkerIds.length} Workers
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Shift Modal */}
      {isShiftModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/70">
          <div className="w-full max-w-md p-5 bg-white rounded-2xl shadow-2xl border border-stone-200">
            <h3 className="text-base font-bold text-stone-900 mb-3">
              {editingShift ? 'Edit Shift' : 'Add Shift'}
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Worker</label>
                <select
                  value={shiftForm.workerId}
                  onChange={(e) => setShiftForm({ ...shiftForm, workerId: e.target.value })}
                  className="w-full p-2 border border-stone-300 rounded-lg"
                >
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Day</label>
                <input
                  type="text"
                  placeholder="Thursday, April 9"
                  value={shiftForm.day}
                  onChange={(e) => setShiftForm({ ...shiftForm, day: e.target.value })}
                  className="w-full p-2 border border-stone-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Time</label>
                <input
                  type="text"
                  placeholder="10:00 AM - 6:00 PM"
                  value={shiftForm.time}
                  onChange={(e) => setShiftForm({ ...shiftForm, time: e.target.value })}
                  className="w-full p-2 border border-stone-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Role</label>
                <input
                  type="text"
                  placeholder="Server"
                  value={shiftForm.role}
                  onChange={(e) => setShiftForm({ ...shiftForm, role: e.target.value })}
                  className="w-full p-2 border border-stone-300 rounded-lg"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setIsShiftModalOpen(false)}
                className="flex-1 py-2 text-xs font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveShiftModal}
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
