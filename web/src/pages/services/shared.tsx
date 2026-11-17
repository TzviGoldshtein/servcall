import { useEffect, useState } from 'react';
import { api, can, type Me, type Role } from '../../api';
import './services.css';

/** התפקיד של המשתמש בחברה הפעילה — רק להסתרת כפתורים; ההרשאה האמיתית בשרת. */
export function useRole(): Role {
  const [role, setRole] = useState<Role>('viewer');
  useEffect(() => {
    api
      .get<Me>('/api/auth/me')
      .then((me) => setRole(me.memberships.find((m) => m.companyId === me.companyId)?.role ?? 'viewer'))
      .catch(() => {});
  }, []);
  return role;
}

export { can };

export interface Option {
  id: number;
  name: string;
}

/** רשימת הלקוחות של החברה, כפי שמסך הדו"חות מקבל אותה. */
export function useOptions() {
  const [clients, setClients] = useState<Option[]>([]);
  useEffect(() => {
    api
      .get<{ clients: Option[] }>('/api/reports/options')
      .then((o) => setClients(o.clients))
      .catch(() => {});
  }, []);
  return { clients };
}

/** הורדת קובץ בקישור ישיר — הסינון כבר בכתובת. */
export const download = (url: string) => {
  window.location.href = url;
};

/** מספר עם עד שתי ספרות. */
export const num = (n: number, lang: 'he' | 'en'): string =>
  n.toLocaleString(lang === 'en' ? 'en-GB' : 'he-IL', { maximumFractionDigits: 2 });
