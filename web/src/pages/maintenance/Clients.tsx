import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { ErrorText, Pager, s, SortHeader, useLang, useLoad, yesNo } from './shared';
import ClientForm, { type ClientRow } from './ClientForm';

/**
 * רשימת הלקוחות — המסך שהנציגים חיים בו. כמו ב-Loren: סינון בכל עמודה, מיון
 * בלחיצה על הכותרת, 15 שורות בדף, וייצוא לאקסל של אותו סינון בדיוק.
 *
 * מה שמוצג כאן הוא הלקוח המשותף *ממוזג* עם ההגדרות של החברה שאני עובד בה:
 * ההערה האדומה, האחראי, עלות השעה והדגל "לא מקבל הודעות" הם של החברה הזו
 * בלבד, ובחברה אחרת אותו לקוח ייראה אחרת לגמרי.
 */

export interface ClientGroup {
  id: number;
  name: string;
  manager: string | null;
  active: boolean;
  clients: number;
}

interface UserOption {
  id: number;
  name: string;
}

interface ClientPage {
  rows: ClientRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

const EMPTY = { name: '', vatId: '', city: '', phone: '', callRemarks: '', groupId: '', ownerId: '', offline: '' };

export default function Clients() {
  const { lang, tx } = useLang();
  const [typed, setTyped] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [withInactive, setWithInactive] = useState(false);
  const [sort, setSort] = useState('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ClientRow | null | undefined>(undefined);

  // הקלדה בשדה סינון לא שולחת בקשה על כל אות
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(typed);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) q.set(key, value);
    if (withInactive) q.set('all', '1');
    q.set('sort', sort);
    q.set('dir', dir);
    q.set('page', String(page));
    return q;
  }, [filters, withInactive, sort, dir, page]);

  const list = useLoad(() => api.get<ClientPage>(`/api/clients?${query.toString()}`), [query.toString()]);
  const groups = useLoad(() => api.get<ClientGroup[]>('/api/client-groups'), []);
  const owners = useLoad(() => api.get<UserOption[]>('/api/users/options'), []);

  const onSort = (column: string) => {
    if (column === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(column);
      setDir('asc');
    }
    setPage(1);
  };

  const filterInput = (key: keyof typeof EMPTY, label: string) => (
    <input
      style={s.filter}
      value={typed[key]}
      onChange={(e) => setTyped({ ...typed, [key]: e.target.value })}
      aria-label={tx(`סינון לפי ${label}`, `Filter by ${label}`)}
    />
  );

  return (
    <div style={s.page}>
      <div style={s.head}>
        <h2 style={{ ...s.title, flex: 1 }}>{tx('לקוחות', 'Clients')}</h2>
        <label style={{ ...s.row, gap: 6 }}>
          <input type="checkbox" checked={withInactive} onChange={(e) => setWithInactive(e.target.checked)} />
          {tx('כולל מושבתים', 'Include inactive')}
        </label>
        {/* הייצוא יורד מהשרת עם אותו סינון; הדפדוף לא חל עליו */}
        <a style={{ ...s.button, textDecoration: 'var(--link-decoration, none)' }} href={`/api/clients/export.xlsx?${query.toString()}`}>
          {tx('ייצוא לאקסל', 'Export to Excel')}
        </a>
        <button type="button" style={s.primary} onClick={() => setEditing(null)}>
          {tx('לקוח חדש', 'New client')}
        </button>
      </div>

      <ErrorText>{list.error}</ErrorText>

      <table style={s.table}>
        <thead>
          <tr>
            <SortHeader column="name" label={tx('שם הלקוח', 'Client')} sort={sort} dir={dir} onSort={onSort} />
            <SortHeader column="vatId" label={tx('ח.פ.', 'VAT id')} sort={sort} dir={dir} onSort={onSort} />
            <SortHeader column="group" label={tx('קבוצה', 'Group')} sort={sort} dir={dir} onSort={onSort} />
            <SortHeader column="phone" label={tx('טלפון', 'Phone')} sort={sort} dir={dir} onSort={onSort} />
            <SortHeader column="city" label={tx('עיר', 'City')} sort={sort} dir={dir} onSort={onSort} />
            <SortHeader column="owner" label={tx('אחראי בחברה', 'Owner here')} sort={sort} dir={dir} onSort={onSort} />
            <SortHeader column="hourCost" label={tx('עלות שעה', 'Hour cost')} sort={sort} dir={dir} onSort={onSort} />
            <th style={s.th}>{tx('הערות לקריאה', 'Call remarks')}</th>
            <th style={s.th}>{tx('אנשי קשר', 'Contacts')}</th>
            <th style={s.th}>{tx('פעיל', 'Active')}</th>
          </tr>
          <tr>
            <th style={s.filterCell}>{filterInput('name', tx('שם', 'name'))}</th>
            <th style={s.filterCell}>{filterInput('vatId', tx('ח.פ.', 'VAT id'))}</th>
            <th style={s.filterCell}>
              <select
                style={s.filter}
                value={typed.groupId}
                onChange={(e) => setTyped({ ...typed, groupId: e.target.value })}
                aria-label={tx('סינון לפי קבוצה', 'Filter by group')}
              >
                <option value="">{tx('הכול', 'All')}</option>
                {(groups.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </th>
            <th style={s.filterCell}>{filterInput('phone', tx('טלפון', 'phone'))}</th>
            <th style={s.filterCell}>{filterInput('city', tx('עיר', 'city'))}</th>
            <th style={s.filterCell}>
              <select
                style={s.filter}
                value={typed.ownerId}
                onChange={(e) => setTyped({ ...typed, ownerId: e.target.value })}
                aria-label={tx('סינון לפי אחראי', 'Filter by owner')}
              >
                <option value="">{tx('הכול', 'All')}</option>
                {(owners.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </th>
            <th style={s.filterCell} />
            <th style={s.filterCell}>{filterInput('callRemarks', tx('הערות', 'remarks'))}</th>
            <th style={s.filterCell}>
              <select
                style={s.filter}
                value={typed.offline}
                onChange={(e) => setTyped({ ...typed, offline: e.target.value })}
                aria-label={tx('סינון לפי קבלת הודעות', 'Filter by messaging')}
              >
                <option value="">{tx('הכול', 'All')}</option>
                <option value="1">{tx('לא מקבל הודעות', 'Offline')}</option>
                <option value="0">{tx('מקבל הודעות', 'Online')}</option>
              </select>
            </th>
            <th style={s.filterCell} />
          </tr>
        </thead>
        <tbody>
          {(list.data?.rows ?? []).map((client) => (
            <tr
              key={client.id}
              onClick={() => setEditing(client)}
              style={{ cursor: 'pointer', ...(client.active && client.companyActive ? null : s.muted) }}
            >
              <td style={s.td}>
                {client.name}
                {client.offline && (
                  <span style={{ ...s.badge, marginInlineStart: 6 }}>{tx('לא מקבל הודעות', 'Offline')}</span>
                )}
              </td>
              <td style={s.td} dir="ltr">
                {client.vatId ?? '—'}
              </td>
              <td style={s.td}>{client.groupName ?? '—'}</td>
              <td style={s.td} dir="ltr">
                {client.phone ?? client.mobile ?? '—'}
              </td>
              <td style={s.td}>{client.city ?? '—'}</td>
              <td style={s.td}>{client.ownerName ?? '—'}</td>
              <td style={s.td}>{client.hourCost ?? '—'}</td>
              {/* ההערה האדומה של החברה הזו — אותה הערה שתופיע על כל קריאה */}
              <td style={{ ...s.td, ...s.remarks }}>{client.callRemarks ?? ''}</td>
              <td style={s.td}>{client.contacts}</td>
              <td style={s.td}>{yesNo(client.active && client.companyActive, lang)}</td>
            </tr>
          ))}
          {!(list.data?.rows ?? []).length && !list.loading && (
            <tr>
              <td style={s.td} colSpan={10}>
                {tx('לא נמצאו לקוחות בסינון הזה.', 'No clients match these filters.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <Pager
        page={list.data?.page ?? 1}
        pages={list.data?.pages ?? 1}
        total={list.data?.total ?? 0}
        onPage={setPage}
      />

      {editing !== undefined && (
        <ClientForm
          client={editing}
          groups={groups.data ?? []}
          owners={owners.data ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={() => void list.reload()}
        />
      )}
    </div>
  );
}
