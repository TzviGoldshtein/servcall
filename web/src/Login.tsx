import { useEffect, useState, type FormEvent } from 'react';
import { api, type Lang, type Me } from './api';
import { t } from './i18n';
import { ErrorText, useAction } from './ui';

/**
 * כניסה מקומית. אין כאן בחירת חברה: הזהות אחת לכל החברות, והחברה נבחרת אחריה
 * (CompanyPicker) או נקבעת לבד למי שמשויך לאחת בלבד.
 */
export function Login({
  lang,
  notice,
  onDone,
}: {
  lang: Lang;
  /** הודעה שחזרה מכישלון כניסה דרך ווטסאפ צוות. */
  notice: string;
  onDone(me: Me): void;
}) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [waSso, setWaSso] = useState(false);
  const { run, error, busy } = useAction();

  // הכפתור של ווטסאפ צוות מוצג רק כשהחיבור מוגדר בשרת
  useEffect(() => {
    api
      .get<{ waSso: boolean }>('/api/health')
      .then((health) => setWaSso(health.waSso))
      .catch(() => setWaSso(false));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const me = await run(() => api.post<Me>('/api/auth/login', { login, password }));
    if (me) onDone(me);
  }

  return (
    <main className="centered">
      <form className="card" onSubmit={submit}>
        <h1>{t(lang, 'signInTitle')}</h1>
        {notice && <p className="notice">{notice}</p>}
        <label>
          {t(lang, 'loginField')}
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            // המייל נשאר משמאל לימין גם בדף בעברית
            dir="ltr"
            autoFocus
            required
          />
        </label>
        <label>
          {t(lang, 'password')}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <ErrorText>{error}</ErrorText>
        <button className="primary" disabled={busy}>
          {t(lang, 'signIn')}
        </button>
        {waSso && (
          // ניווט מלא ולא fetch: הכניסה עוברת דרך אתר אחר וחוזרת עם עוגייה
          <a className="row" href="/api/auth/wa/start" style={{ justifyContent: 'center' }}>
            {t(lang, 'signInWithWa')}
          </a>
        )}
      </form>
    </main>
  );
}
