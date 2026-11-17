import { useCallback, useEffect, useState } from 'react';
import { api, type CompanyOption, type Lang, type Me } from './api';
import { AppShell, TABS, isTab, type SideSection, type TabId } from './AppShell';
import { CompanyPicker } from './CompanyPicker';
import { IdleTimeout } from './IdleTimeout';
import { Login } from './Login';
import { applyLang, loadLang, saveLang, t } from './i18n';
import { applyTheme, cacheTheme, loadMode, saveMode, themeOf, watchSystemMode, type Mode } from './theme';

/** הנתיב הוא גם המקטע הפעיל, כדי שרענון וסימניה יחזרו לאותו מקום. */
const tabFromPath = (): TabId => {
  const first = location.pathname.split('/')[1] ?? '';
  return isTab(first) ? first : 'calls';
};

/** הודעה שחוזרת מכישלון כניסה דרך ווטסאפ צוות (ראה routes/auth.ts). */
const SSO_NOTICE: Record<string, 'ssoFailed' | 'ssoUsed' | 'ssoUnknown'> = {
  failed: 'ssoFailed',
  used: 'ssoUsed',
  unknown: 'ssoUnknown',
};

export function App() {
  // undefined כל עוד לא ידוע אם יש סשן
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [mode, setMode] = useState<Mode>(loadMode);
  const [lang, setLang] = useState<Lang>(() => loadLang() ?? 'he');
  const [tab, setTab] = useState<TabId>(tabFromPath);
  const [lockAt, setLockAt] = useState(0);
  const [ssoNotice] = useState(() => {
    const reason = new URLSearchParams(location.search).get('sso');
    // הכתובת מתנקה מיד, כדי שרענון לא יציג את השגיאה שוב
    if (reason) history.replaceState(null, '', location.pathname);
    return reason ? SSO_NOTICE[reason] ?? 'ssoFailed' : null;
  });

  const load = useCallback(async () => {
    const fresh = await api.get<Me>('/api/auth/me').catch(() => null);
    setMe(fresh);
    if (fresh) setCompanies(await api.get<CompanyOption[]>('/api/companies').catch(() => []));
    return fresh;
  }, []);

  useEffect(() => void load(), [load]);

  // שפה מהשרת היא ברירת המחדל; בחירה מקומית בדפדפן גוברת עליה
  useEffect(() => {
    if (me && !loadLang()) setLang(me.lang);
  }, [me]);

  useEffect(() => applyLang(lang), [lang]);

  // הערכה של החברה הפעילה, בשני המצבים, מגיעה מהשרת ונשמרת לטעינה הבאה
  useEffect(() => {
    applyTheme(me?.company ? themeOf(me.company) : null, mode);
    if (me) cacheTheme(me.company);
  }, [me, mode]);

  // 'לפי המערכת' חייב להתחלף גם כשהמשתמש מחליף מצב במחשב באמצע העבודה
  useEffect(() => watchSystemMode(() => applyTheme(me?.company ? themeOf(me.company) : null, mode)), [me, mode]);

  useEffect(() => {
    const onPop = () => setTab(tabFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const goTab = (next: TabId) => {
    setTab(next);
    history.pushState(null, '', `/${next}`);
  };

  const chooseMode = (next: Mode) => {
    setMode(next);
    saveMode(next);
  };

  const chooseLang = (next: Lang) => {
    setLang(next);
    saveLang(next);
  };

  const signOut = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setCompanies([]);
    setMe(null);
  };

  const switchCompany = async (companyId: number) => {
    const fresh = await api.post<Me>('/api/auth/company', { companyId }).catch(() => null);
    if (fresh) setMe(fresh);
  };

  if (me === undefined) return <main className="centered muted">{t(lang, 'loading')}</main>;
  if (me === null) {
    return (
      <Login
        lang={lang}
        notice={ssoNotice ? t(lang, ssoNotice) : ''}
        onDone={(fresh) => {
          setMe(fresh);
          void load();
        }}
      />
    );
  }
  if (me.companyId === null) {
    return <CompanyPicker lang={lang} companies={companies} onPicked={setMe} />;
  }

  // המקטעים עצמם נבנים בנפרד; המסגרת מחזיקה להם את המקום בתפריט ובאקורדיון
  const side: SideSection[] = [];

  return (
    <>
      <AppShell
        lang={lang}
        me={me}
        companies={companies}
        tab={tab}
        side={side}
        mode={mode}
        onTab={goTab}
        onCompany={(id) => void switchCompany(id)}
        onMode={chooseMode}
        onLang={chooseLang}
        onSignOut={() => void signOut()}
        onLock={() => setLockAt(Date.now())}
      >
        <div className="panel">
          <h2>{t(lang, TABS.find((item) => item.id === tab)!.key)}</h2>
          <p className="muted">{t(lang, 'comingSoon')}</p>
        </div>
      </AppShell>
      <IdleTimeout
        lang={lang}
        me={me}
        lockNow={lockAt}
        onResumed={setMe}
        onSignOut={() => void signOut()}
      />
    </>
  );
}
