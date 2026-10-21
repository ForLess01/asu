import { useEffect, useState } from 'react';

/** UI freshness only: this clock never mutates measurements or stored snapshots. */
export function useClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setNow(Date.now()); };
    const interval = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return now;
}
