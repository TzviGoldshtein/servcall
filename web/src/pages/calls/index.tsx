/*
 * נקודת החיבור של מודול הקריאות למסגרת האפליקציה.
 *
 * המסגרת (AppShell/App) מנווטת בנתיבים עם history.pushState, ולכן גם כאן:
 *   /calls        — הרשימה
 *   /calls/new    — קריאה חדשה
 *   /calls/<id>   — טופס הקריאה
 *
 * אין כאן ראוטר משל עצמנו: רק קריאה של הנתיב ודחיפה שלו, באותה צורה שהמסגרת
 * עושה — כדי שרענון, סימניה וכפתור "חזור" יעבדו כמו בשאר המערכת.
 */
import { useEffect, useState } from 'react';
import { CallForm } from './CallForm';
import { CallList } from './CallList';
import './calls.css';

type Route = { view: 'list' } | { view: 'new' } | { view: 'call'; id: number };

const routeOf = (): Route => {
  const rest = location.pathname.split('/')[2] ?? '';
  if (rest === 'new') return { view: 'new' };
  const id = Number(rest);
  return Number.isInteger(id) && id > 0 ? { view: 'call', id } : { view: 'list' };
};

export function CallsPage() {
  const [route, setRoute] = useState<Route>(routeOf);

  useEffect(() => {
    const onPop = () => setRoute(routeOf());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (path: string, next: Route) => {
    history.pushState(null, '', path);
    setRoute(next);
  };

  if (route.view === 'list') {
    return (
      <CallList
        onOpen={(id) => go(`/calls/${id}`, { view: 'call', id })}
        onNew={() => go('/calls/new', { view: 'new' })}
      />
    );
  }
  const back = () => go('/calls', { view: 'list' });
  return (
    <CallForm
      {...(route.view === 'call' ? { callId: route.id } : {})}
      onClose={back}
      onOpenCall={(id) => go(`/calls/${id}`, { view: 'call', id })}
    />
  );
}

export { CallForm } from './CallForm';
export { CallList } from './CallList';
export { LinkedBanner } from './LinkedBanner';
export { MyStickyNotes, StickyNotes } from './StickyNotes';
export { TransferDialog } from './TransferDialog';
