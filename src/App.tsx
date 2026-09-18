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
import { ArrowLeft } from 'lucide-react';

export default function App() {
  // Check if URL has ?admin=true or #admin on load
  const isUrlAdminRequested = () => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('admin') === 'true' || window.location.hash === '#admin';
  };

  const [activeView, setActiveView] = useState<'staff' | 'admin'>(() =>
    isUrlAdminRequested() ? 'admin' : 'staff'
  );
  const [liveEventId, setLiveEventId] = useState<string>('rc-show-apr-15-2026');
  const [eventDetails, setEventDetails] = useState<EventDetails>(DEFAULT_EVENT_DETAILS);
  const [workers, setWorkers] = useState<Worker[]>(() => buildSeedWorkers());
  const [isLoading, setIsLoading] = useState(true);

  // Listen for hash change in browser (e.g. user types #admin or #staff in URL)
  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#admin') {
        setActiveView('admin');
      } else if (window.location.hash === '#staff' || !window.location.hash) {
        setActiveView('staff');
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

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
      {/* Admin Mode Top Navigation - ONLY displayed when actively inside the Admin Panel */}
      {activeView === 'admin' && (
        <nav className="bg-stone-950 text-stone-300 border-b border-stone-800 px-4 py-2 flex items-center justify-between gap-3 text-xs sticky top-0 z-40 shadow-md">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setActiveView('staff');
                if (window.location.hash === '#admin') {
                  window.location.hash = '';
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 font-semibold transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Staff Portal
            </button>
            <span className="font-bold text-white tracking-tight hidden sm:inline">Admin Mode</span>
          </div>

          <div className="flex items-center gap-2 font-mono text-2xs text-stone-400">
            <span className="hidden md:inline-flex items-center gap-1 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> RTDB Connected
            </span>
            <span className="bg-stone-900 border border-stone-800 px-2 py-0.5 rounded text-rose-300">
              Live ID: {liveEventId}
            </span>
          </div>
        </nav>
      )}

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
            onOpenAdminPanel={() => setActiveView('admin')}
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
