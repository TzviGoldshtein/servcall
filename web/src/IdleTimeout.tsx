import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Lang, type Me } from './api';
import { t } from './i18n';
import { ErrorText, useAction } from './ui';

/**
 * נעילה בחוסר פעילות.
 *
 * הכלל עצמו מוגדר בשרת (server/src/idle.ts) ונשלח ב-/api/auth/me: אחרי
 * `logoutMinutes` ללא נגיעה המסך נעול, ודקה לפניה מוצגת אזהרה עם ספירה לאחור.
 * כאן מודדים פעילות אמיתית — הקלדה, עכבר, מגע — כי בקשות רקע מחדשות את הסשן
 * בשרת ואינן עדות לכך שמישהו יושב מול המסך.
 *
 * הנעילה היא שכבה מעל האפליקציה ולא יציאה: הדף אינו נטען מחדש, ולכן טופס קריאה
 * שמולא למחצה נשאר במקומו. הסשן בשרת נסגר מיד עם הנעילה, והחזרה פותחת סשן חדש
 * באותה חברה — סיסמה בלבד, בלי לבחור חברה שוב.
 */

/** זהה ל-idlePhase בשרת. */
function phaseOf(idleMs: number, minutes: number, warnSeconds: number): 'active' | 'warning' | 'locked' {
  if (!(minutes > 0)) return 'active';
  const lockAt = minutes * 60_000;
  if (idleMs >= lockAt) return 'locked';
  return idleMs >= lockAt - warnSeconds * 1000 ? 'warning' : 'active';
}

const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

export function IdleTimeout({
  lang,
  me,
  lockNow,
  onResumed,
  onSignOut,
}: {
  lang: Lang;
  me: Me;
  /** חותמת זמן שעולה כשמבקשים נעילה מיידית מתפריט המשתמש. */
  lockNow: number;
  onResumed(me: Me): void;
  onSignOut(): void;
}) {
  const { logoutMinutes, warnSeconds } = me.idle;
  const [phase, setPhase] = useState<'active' | 'warning' | 'locked'>('active');
  const [left, setLeft] = useState(warnSeconds);
  const [password, setPassword] = useState('');
  const lastActivity = useRef(Date.now());
  const { run, error, busy, clearError } = useAction();

  const touch = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    if (phase === 'locked') return;
    for (const event of ACTIVITY) window.addEventListener(event, touch, { passive: true });
    return () => {
      for (const event of ACTIVITY) window.removeEventListener(event, touch);
    };
  }, [phase, touch]);

  // נעילה ביזמת המשתמש: יוצא מהמחשב ולא רוצה לחכות לשעון
  useEffect(() => {
    if (lockNow) setPhase('locked');
  }, [lockNow]);

  useEffect(() => {
    if (phase === 'locked' || !(logoutMinutes > 0)) return;
    const timer = setInterval(() => {
      const idleMs = Date.now() - lastActivity.current;
      const next = phaseOf(idleMs, logoutMinutes, warnSeconds);
      setPhase(next);
      setLeft(Math.max(0, Math.ceil((logoutMinutes * 60_000 - idleMs) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, logoutMinutes, warnSeconds]);

  // הסשן בשרת נסגר ברגע הנעילה, כדי שמחשב שנשאר פתוח לא יישאר מחובר
  useEffect(() => {
    if (phase !== 'locked') return;
    setPassword('');
    clearError();
    void api.post('/api/auth/logout').catch(() => {});
  }, [phase, clearError]);

  const stay = () => {
    touch();
    setPhase('active');
    // מרענן את חלון חוסר הפעילות גם בשרת
    void api.get<Me>('/api/auth/me').catch(() => {});
  };

  async function unlock(event: FormEvent) {
    event.preventDefault();
    const fresh = await run(() =>
      api.post<Me>('/api/auth/login', {
        login: me.user.email,
        password,
        // חוזרים בדיוק לחברה שבה עבדנו, ולא למסך בחירה
        companyId: me.companyId,
      }),
    );
    if (!fresh) return;
    setPassword('');
    touch();
    setPhase('active');
    onResumed(fresh);
  }

  if (phase === 'locked') {
    return (
      <div className="lock" role="dialog" aria-modal="true" aria-label={t(lang, 'lockedTitle')}>
        <form className="card" onSubmit={unlock}>
          <h1>{t(lang, 'lockedTitle')}</h1>
          <p className="muted">{t(lang, 'lockedBody')}</p>
          <p>
            <strong>{me.user.email}</strong>
          </p>
          <label>
            {t(lang, 'password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </label>
          <ErrorText>{error}</ErrorText>
          <button className="primary" disabled={busy}>
            {t(lang, 'unlock')}
          </button>
          <button type="button" className="quiet" disabled={busy} onClick={onSignOut}>
            {t(lang, 'signInAsSomeoneElse')}
          </button>
        </form>
      </div>
    );
  }

  if (phase !== 'warning') return null;
  return (
    <div className="idle-warn" role="alert">
      <strong>{t(lang, 'idleWarnTitle')}</strong>
      <span>{t(lang, 'idleWarnBody', { n: left })}</span>
      <button className="primary" onClick={stay}>
        {t(lang, 'stayConnected')}
      </button>
    </div>
  );
}
