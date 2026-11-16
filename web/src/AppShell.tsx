import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { companyLabel, fullName, type CompanyOption, type Lang, type Me } from './api';
import { roleLabel, t, type MessageKey } from './i18n';
import type { Mode } from './theme';

/** ששת המקטעים של המערכת. התוכן עצמו נבנה בנפרד; כאן רק הניווט. */
export const TABS = [
  { id: 'calls', key: 'tabCalls' },
  { id: 'clients', key: 'tabClients' },
  { id: 'hours', key: 'tabHours' },
  { id: 'billing', key: 'tabBilling' },
  { id: 'reports', key: 'tabReports' },
  { id: 'settings', key: 'tabSettings' },
] as const satisfies readonly { id: string; key: MessageKey }[];

export type TabId = (typeof TABS)[number]['id'];
export const isTab = (value: string): value is TabId => TABS.some((tab) => tab.id === value);

/** מקטע באקורדיון הצדדי. המקטעים עצמם מגיעים מהמסך שמוצג כרגע. */
export interface SideSection {
  id: string;
  title: string;
  content: ReactNode;
}

export function AppShell({
  lang,
  me,
  companies,
  tab,
  side,
  mode,
  onTab,
  onCompany,
  onMode,
  onLang,
  onSignOut,
  onLock,
  children,
}: {
  lang: Lang;
  me: Me;
  companies: CompanyOption[];
  tab: TabId;
  side: SideSection[];
  mode: Mode;
  onTab(tab: TabId): void;
  onCompany(companyId: number): void;
  onMode(mode: Mode): void;
  onLang(lang: Lang): void;
  onSignOut(): void;
  onLock(): void;
  children: ReactNode;
}) {
  const active = me.company;
  const membership = me.memberships.find((m) => m.companyId === me.companyId);

  return (
    <div className="shell">
      <header>
        {active?.logoUrl ? (
          <img className="logo" src={active.logoUrl} alt={active.name} />
        ) : (
          <strong>ServCall</strong>
        )}

        <Dropdown
          label={active ? companyLabel(active, lang) : t(lang, 'activeCompany')}
          title={t(lang, 'switchCompany')}
          // נקודת הצבע של החברה הפעילה נשארת גלויה גם כשהתפריט סגור
          lead={<span className="swatch" style={swatch(active?.brandPrimary)} aria-hidden />}
        >
          {(close) => (
            <>
              <p className="label">{t(lang, 'switchCompany')}</p>
              {companies.map((company) => (
                <button
                  key={company.id}
                  role="menuitemradio"
                  aria-checked={company.id === me.companyId}
                  onClick={() => {
                    close();
                    if (company.id !== me.companyId) onCompany(company.id);
                  }}
                >
                  <span className="swatch" style={swatch(company.brandPrimary)} aria-hidden />
                  <span className="spacer">{companyLabel(company, lang)}</span>
                  <span className="muted">{roleLabel(lang, company.role)}</span>
                </button>
              ))}
            </>
          )}
        </Dropdown>

        <span className="spacer" />

        <Dropdown label={fullName(me.user)} title={t(lang, 'userMenu')}>
          {(close) => (
            <>
              <p className="label">
                {membership
                  ? `${roleLabel(lang, membership.role)}${
                      membership.extension ? ` · ${t(lang, 'myExtension')} ${membership.extension}` : ''
                    }`
                  : me.user.email}
              </p>
              <hr />
              <p className="label">{t(lang, 'appearance')}</p>
              {(['system', 'light', 'dark'] as const).map((option) => (
                <button
                  key={option}
                  role="menuitemradio"
                  aria-checked={mode === option}
                  onClick={() => onMode(option)}
                >
                  {t(lang, option === 'system' ? 'modeSystem' : option === 'light' ? 'modeLight' : 'modeDark')}
                </button>
              ))}
              <hr />
              <p className="label">{t(lang, 'language')}</p>
              {(['he', 'en'] as const).map((option) => (
                <button
                  key={option}
                  role="menuitemradio"
                  aria-checked={lang === option}
                  onClick={() => onLang(option)}
                >
                  {t(lang, option === 'he' ? 'langHe' : 'langEn')}
                </button>
              ))}
              <hr />
              <button
                onClick={() => {
                  close();
                  onLock();
                }}
              >
                {t(lang, 'lockNow')}
              </button>
              <button
                onClick={() => {
                  close();
                  onSignOut();
                }}
              >
                {t(lang, 'signOut')}
              </button>
            </>
          )}
        </Dropdown>
      </header>

      {/* רמז דק בצבע הגולמי של החברה: מי שעובד בשתי לשוניות רואה מיד איפה הוא */}
      <div className="context-strip" aria-hidden />

      <nav className="tabs" aria-label={t(lang, 'menu')}>
        {TABS.map((item) => (
          <button
            key={item.id}
            aria-current={item.id === tab ? 'page' : undefined}
            onClick={() => onTab(item.id)}
          >
            {t(lang, item.key)}
          </button>
        ))}
      </nav>

      <div className="body">
        <aside>
          <Accordion lang={lang} sections={side} />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}

const swatch = (color: string | undefined): CSSProperties =>
  ({ '--card-brand': color ?? 'transparent' }) as CSSProperties;

/** האקורדיון הצדדי. המסכים מזינים אליו מקטעים; בלעדיהם הוא נשאר ריק ומוצהר. */
function Accordion({ lang, sections }: { lang: Lang; sections: SideSection[] }) {
  const [open, setOpen] = useState<string | null>(sections[0]?.id ?? null);
  return (
    <div className="accordion">
      <h3>{t(lang, 'sections')}</h3>
      {sections.length === 0 && <p className="empty">{t(lang, 'sectionsEmpty')}</p>}
      {sections.map((section) => (
        <section key={section.id}>
          <button
            className="head"
            aria-expanded={open === section.id}
            onClick={() => setOpen(open === section.id ? null : section.id)}
          >
            {/* ◂ ולא ‹: הסימן מתהפך לבד עם כיוון הדף */}
            <span className="chevron" aria-hidden>
              ▸
            </span>
            <span className="spacer">{section.title}</span>
          </button>
          {open === section.id && <div className="content">{section.content}</div>}
        </section>
      ))}
    </div>
  );
}

/** תפריט נפתח שנסגר בלחיצה בחוץ או ב-Escape. */
function Dropdown({
  label,
  title,
  lead,
  children,
}: {
  label: string;
  title: string;
  lead?: ReactNode;
  children(close: () => void): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-host" ref={host}>
      <button className="row" title={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {lead}
        <span>{label}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
