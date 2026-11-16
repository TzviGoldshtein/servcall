import { randomBytes } from 'node:crypto';

const int = (v: string | undefined, d: number) => (v && Number.isFinite(+v) ? +v : d);

export const config = {
  port: int(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://servcall:servcall@localhost:5433/servcall',
  mediaDir: process.env.MEDIA_DIR ?? new URL('../../data/files', import.meta.url).pathname,
  webDir: process.env.WEB_DIR ?? new URL('../../web/dist', import.meta.url).pathname,
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 25),
  /** ניתוק אוטומטי בחוסר פעילות. ניתן לדריסה פר חברה בפרמטרים. */
  idleLogoutMinutes: int(process.env.IDLE_LOGOUT_MINUTES, 45),
  sessionDays: int(process.env.SESSION_DAYS, 30),
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE ?? '972',
  /** חיבור ל-wa-team: SSO ופאנל הקריאות בצ'אט. ריק = כבוי. */
  waTeamUrl: process.env.WA_TEAM_URL ?? '',
  waTeamToken: process.env.WA_TEAM_TOKEN ?? '',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? '',
  },
  isProd: process.env.NODE_ENV === 'production',
  secret: process.env.APP_SECRET ?? randomBytes(32).toString('hex'),
};

export type Config = typeof config;
