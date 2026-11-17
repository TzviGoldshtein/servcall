/*
 * נקודת החיבור של מסכי התחזוקה למעטפת, באותה צורה שמודול הקריאות מתחבר:
 * בלי ראוטר משלנו — קוראים את הנתיב ודוחפים אותו עם history.pushState, כדי
 * שרענון, סימניה וכפתור "חזור" יעבדו כמו בשאר המערכת.
 *
 *   /clients            — רשימת הלקוחות (לשונית "לקוחות")
 *   /settings/<page>    — שאר נתוני הבסיס, לפי MAINTENANCE_PAGES (לשונית "הגדרות")
 *
 * Branding.tsx אינו כאן; המודול שלו מוסיף את עצמו ללשונית ההגדרות.
 */
import { useEffect, useState } from 'react';
import { MAINTENANCE_PAGES } from './index';
import Clients from './Clients';
import ClientGroups from './ClientGroups';
import Departments from './Departments';
import Importer from './Importer';
import Lookups from './Lookups';
import Params from './Params';
import Users from './Users';
import { s, useLang } from './shared';

// "לקוחות" נמצאת בלשונית משלה, ולכן לא חלק מתת-הניווט של ההגדרות
const SETTINGS_PAGES = MAINTENANCE_PAGES.filter((item) => item.path !== 'clients');
type PageId = (typeof SETTINGS_PAGES)[number]['path'];

const pageOf = (): PageId => {
  const rest = location.pathname.split('/')[2] ?? '';
  return SETTINGS_PAGES.find((item) => item.path === rest)?.path ?? 'users';
};

/** לשונית "לקוחות": הרשימה, ומתוכה הטופס ואנשי הקשר. */
export function ClientsPage() {
  return <Clients />;
}

/** לשונית "הגדרות": תת-ניווט בין מסכי נתוני הבסיס. */
export function SettingsPage() {
  const { lang } = useLang();
  const [page, setPage] = useState<PageId>(pageOf);

  useEffect(() => {
    const onPop = () => setPage(pageOf());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (next: PageId) => {
    history.pushState(null, '', `/settings/${next}`);
    setPage(next);
  };

  return (
    <div>
      <nav style={{ ...s.row, padding: '12px 16px 0' }} aria-label={lang === 'en' ? 'Settings' : 'הגדרות'}>
        {SETTINGS_PAGES.map((item) => (
          <button
            key={item.path}
            style={item.path === page ? s.primary : s.button}
            aria-current={item.path === page ? 'page' : undefined}
            onClick={() => go(item.path)}
          >
            {lang === 'en' ? item.en : item.he}
          </button>
        ))}
      </nav>
      {page === 'users' && <Users />}
      {page === 'departments' && <Departments />}
      {page === 'client-groups' && <ClientGroups />}
      {page === 'lookups' && <Lookups />}
      {page === 'params' && <Params />}
      {page === 'import' && <Importer />}
    </div>
  );
}
