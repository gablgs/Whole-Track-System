import { useState, useEffect } from 'react';
import { EventConfigPayload, EventDetails, ScheduledShiftRow, Worker } from './types';
import {
  DEFAULT_EVENT_DETAILS,
  getEventConfig,
  getLiveEventId,
  sanitizeEventId,
} from './services/firebase';
import { buildSeedWorkers, SEED_SCHEDULE_ROWS } from './data/seedSchedule';
import { StaffPortal } from './components/StaffPortal';
import { EventAdminPanel } from './components/EventAdminPanel';
import { Smartphone, LayoutDashboard, Database, CheckCircle2 } from 'lucide-react';

export default function App() {
  const [activeView, setActiveView] = useState<'staff' | 'admin'>('staff');
  const [liveEventId, setLiveEventId] = useState<string>('rc-show-apr-15-2026');
  const [eventDetails, setEventDetails] = useState<EventDetails>(DEFAULT_EVENT_DETAILS);
  const [workers, setWorkers] = useState<Worker[]>(() => buildSeedWorkers());
  const [isLoading, setIsLoading] = useState(true);

  // Initialize live event data from Firebase
  useEffect(() => {
    async function init() {
      setIsLoading(true);
      try {
        const liveId = await getLiveEventId();
        const cleanId = sanitizeEventId(liveId || 'rc-show-apr-15-2026');
        setLiveEventId(cleanId);

        const config = await getEventConfig(cleanId);
        if (config && config.event) {
          setEventDetails(config.event);
          if (config.workers && config.workers.length > 0) {
            setWorkers(config.workers);
          }
        }
      } catch (err) {
        console.warn('Could not load live event from Firebase, using default seed:', err);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  // Compute flat scheduled shifts for the Staff Portal
  const scheduledRows: ScheduledShiftRow[] = workers.flatMap((w) =>
    w.shifts.map((s) => ({
      name: w.name,
      day: s.day,
      role: s.role,
      time: s.time,
    }))
  );

  const fallbackScheduledRows = scheduledRows.length > 0 ? scheduledRows : SEED_SCHEDULE_ROWS;

  const currentPayload: EventConfigPayload = {
    eventId: liveEventId,
    event: eventDetails,
    workers,
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col">
      {/* Top Application Mode Switcher Bar */}
      <nav className="bg-stone-900 text-stone-300 border-b border-stone-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs sticky top-0 z-40 shadow-xs">
        <div className="flex items-center gap-2.5">
          <span className="font-bold text-white tracking-tight text-sm">Staff Hours System</span>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono text-2xs">
            <Database className="w-3 h-3" /> Firebase RTDB Connected
          </span>
          <span className="text-stone-400 font-mono text-2xs">Live: {liveEventId}</span>
        </div>

        {/* View mode toggle pills */}
        <div className="flex items-center gap-1 bg-stone-950 p-1 rounded-xl border border-stone-800">
          <button
            onClick={() => setActiveView('staff')}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors ${
              activeView === 'staff'
                ? 'bg-rose-700 text-white shadow-xs'
                : 'text-stone-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" /> Staff Mobile Portal
          </button>

          <button
            onClick={() => setActiveView('admin')}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors ${
              activeView === 'admin'
                ? 'bg-rose-700 text-white shadow-xs'
                : 'text-stone-400 hover:text-white'
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" /> Event Admin Panel
          </button>
        </div>
      </nav>

      {/* Main View Area */}
      <div className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-3 border-rose-700 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-stone-500 font-medium">Syncing live event data from Firebase…</p>
            </div>
          </div>
        ) : activeView === 'staff' ? (
          <StaffPortal
            eventId={liveEventId}
            eventDetails={eventDetails}
            scheduledRows={fallbackScheduledRows}
          />
        ) : (
          <EventAdminPanel
            liveEventId={liveEventId}
            onLiveEventChanged={(newId) => {
              setLiveEventId(newId);
              setEventDetails((prev) => ({ ...prev, status: 'live' }));
            }}
            initialConfig={currentPayload}
          />
        )}
      </div>
    </div>
  );
}
