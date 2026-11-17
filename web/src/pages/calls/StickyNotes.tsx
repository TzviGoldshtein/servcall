/*
 * פתקים והערות כרטיס.
 *
 * `sticky` — פתק תזכורת מול העיניים של נציג אחד, עם זמן תזכורת וסימון ביצוע.
 *            הוא לא ידע משותף: הוא מה שמישהו צריך לעשות. פתק שעבר זמנו מסומן.
 * `card`   — הערת כרטיס לקוח, חלק מה-CRM המשותף לכל החברות: מה שאנחנו יודעים
 *            על הלקוח, ונשאר גם אחרי שהקריאה נסגרה.
 *
 * שני הסוגים מגיעים גם לפי לקוח וגם לפי קריאה, ועוברים דרך אותו API שמערכת
 * הווטסאפ משתמשת בו — ולכן אין כאן לוגיקה שהשרת לא מכיר.
 */
import { useCallback, useEffect, useState } from 'react';
import { callsApi, dateText, t, type Note } from './callsApi';
import './calls.css';

type Scope = { callId: number; clientId?: number } | { clientId: number; callId?: number };

export function StickyNotes({
  scope,
  kinds = ['sticky', 'card'],
  agents = [],
  meId,
}: {
  /** לפי קריאה, לפי לקוח, או שניהם */
  scope: Scope;
  kinds?: ('sticky' | 'card')[];
  agents?: { id: number; name: string | null }[];
  /** המשתמש הנוכחי; פתק חדש מוצמד אליו כברירת מחדל */
  meId?: number;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<'sticky' | 'card'>(kinds[0] ?? 'sticky');
  const [dueAt, setDueAt] = useState('');
  const [pinnedFor, setPinnedFor] = useState<string>(meId ? String(meId) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const query = scope.callId ? `callId=${scope.callId}` : `clientId=${scope.clientId}`;

  const reload = useCallback(() => {
    callsApi
      .notes(query)
      .then(setNotes)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('שגיאה', 'Error')));
  }, [query]);

  useEffect(reload, [reload]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('שגיאה', 'Error'));
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      await callsApi.addNote({
        kind,
        body: draft,
        callId: scope.callId ?? null,
        clientId: scope.clientId ?? null,
        ...(kind === 'sticky'
          ? { dueAt: dueAt ? new Date(dueAt).toISOString() : null, pinnedFor: pinnedFor ? Number(pinnedFor) : null }
          : {}),
      });
      setDraft('');
      setDueAt('');
    });

  const stickies = notes.filter((n) => n.kind === 'sticky');
  const cards = notes.filter((n) => n.kind === 'card');
  const late = (note: Note) => !note.doneAt && !!note.dueAt && new Date(note.dueAt).getTime() < Date.now();

  return (
    <section aria-label={t('הערות ופתקים', 'Notes and stickies')}>
      {kinds.includes('sticky') && stickies.length > 0 ? (
        <div className="stickies">
          {stickies.map((note) => (
            <article
              key={note.id}
              className={['sticky', late(note) ? 'overdue' : '', note.doneAt ? 'done' : ''].filter(Boolean).join(' ')}
            >
              <div className="body">{note.body}</div>
              <div className="meta">
                {note.pinnedForName ? `${t('מול', 'For')} ${note.pinnedForName}` : ''}
                {note.dueAt ? ` · ${t('לתזכורת', 'Due')} ${dateText(note.dueAt, true)}` : ''}
                {note.doneAt ? ` · ${t('בוצע', 'Done')} ${dateText(note.doneAt, true)}` : ''}
                {note.callNumber && !scope.callId ? ` · ${t('קריאה', 'Call')} ${note.callNumber}` : ''}
              </div>
              <div className="call-actions">
                <button type="button" disabled={busy} onClick={() => void run(() => callsApi.noteDone(note.id, !note.doneAt))}>
                  {note.doneAt ? t('ביטול ביצוע', 'Undo done') : t('סימון כבוצע', 'Mark done')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    // מחיקה היא הדרך האחרונה; גם לפתק מבקשים אישור
                    if (confirm(t('למחוק את הפתק?', 'Delete this sticky?'))) void run(() => callsApi.removeNote(note.id));
                  }}
                >
                  {t('מחיקה', 'Delete')}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {kinds.includes('card') ? (
        <div className="card-notes">
          <h3>{t('הערות כרטיס הלקוח', 'Customer card notes')}</h3>
          {cards.map((note) => (
            <article key={note.id} className="card-note">
              <div className="meta muted">
                {dateText(note.createdAt, true)} · {note.authorName ?? ''}
                {note.editedAt ? ` · ${t('נערך', 'edited')}` : ''}
              </div>
              {note.body}
            </article>
          ))}
          {cards.length === 0 ? <p className="muted">{t('אין הערות על הלקוח', 'No notes about this client')}</p> : null}
        </div>
      ) : null}

      <div className="call-fields">
        <label className="wide">
          {t('הערה חדשה', 'New note')}
          <textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        {kinds.length > 1 ? (
          <label>
            {t('סוג', 'Kind')}
            <select value={kind} onChange={(e) => setKind(e.target.value === 'card' ? 'card' : 'sticky')}>
              <option value="sticky">{t('פתק תזכורת (אישי)', 'Sticky reminder (personal)')}</option>
              <option value="card">{t('הערת כרטיס לקוח (משותפת)', 'Customer card note (shared)')}</option>
            </select>
          </label>
        ) : null}
        {kind === 'sticky' ? (
          <>
            <label>
              {t('זמן תזכורת', 'Remind at')}
              <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </label>
            <label>
              {t('מול מי הפתק', 'Pinned for')}
              <select value={pinnedFor} onChange={(e) => setPinnedFor(e.target.value)}>
                <option value="">{t('אני', 'Me')}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? a.id}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <div className="call-actions">
          <button type="button" disabled={busy || !draft.trim()} onClick={() => void add()}>
            {t('הוספה', 'Add')}
          </button>
        </div>
      </div>

      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  );
}

/** הפתקים שלי מכל הקריאות — לסרגל הקבוע של הנציג. */
export function MyStickyNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    callsApi.myStickies().then(setNotes).catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  if (notes.length === 0) return null;
  const late = (note: Note) => !!note.dueAt && new Date(note.dueAt).getTime() < Date.now();

  return (
    <section className="stickies" aria-label={t('הפתקים שלי', 'My stickies')}>
      {notes.map((note) => (
        <article key={note.id} className={late(note) ? 'sticky overdue' : 'sticky'}>
          <div className="body">{note.body}</div>
          <div className="meta">
            {note.callNumber ? `${t('קריאה', 'Call')} ${note.callNumber}` : (note.clientName ?? '')}
            {note.dueAt ? ` · ${dateText(note.dueAt, true)}` : ''}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              callsApi
                .noteDone(note.id, true)
                .then(reload)
                .catch(() => {})
                .finally(() => setBusy(false));
            }}
          >
            {t('סימון כבוצע', 'Mark done')}
          </button>
        </article>
      ))}
    </section>
  );
}
