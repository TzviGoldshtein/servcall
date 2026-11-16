/*
 * הבאנר של קריאה מקושרת.
 *
 * הצד המקבל: שם החברה שממנה הגיעה העבודה, הסיבה, וצפייה באירועי קריאת האב —
 * לקריאה בלבד. אם הקישור נושא relay_allowed, יש כאן גם טופס *בקשה* להעברת
 * הודעה ללקוח: הבקשה הולכת לנציג של החברה המקורית לאישור, ולא נשלחת מעצמה.
 *
 * הצד השולח: אילו חברות קיבלו עבודה מהקריאה הזו, ומה מספר קריאת הבת שלהן.
 */
import { useEffect, useState } from 'react';
import {
  callsApi,
  dateText,
  ltr,
  t,
  type CallLink,
  type CallOrigin,
  type RelayRequest,
} from './callsApi';
import './calls.css';

export function LinkedBanner({ callId, onChanged }: { callId: number; onChanged?(): void }) {
  const [origin, setOrigin] = useState<CallOrigin | null>(null);
  const [links, setLinks] = useState<CallLink[]>([]);
  const [relays, setRelays] = useState<RelayRequest[]>([]);
  const [showEvents, setShowEvents] = useState(false);
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = () => {
    void Promise.all([callsApi.origin(callId), callsApi.links(callId), callsApi.relayRequests(callId)])
      .then(([o, l, r]) => {
        setOrigin(o);
        setLinks(l);
        setRelays(r);
      })
      .catch(() => {});
  };

  useEffect(reload, [callId]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('שגיאה', 'Error'));
    } finally {
      setBusy(false);
    }
  };

  const outgoing = links.filter((l) => l.outgoing);
  const pending = relays.filter((r) => r.status === 'pending');
  if (!origin && outgoing.length === 0 && relays.length === 0) return null;

  return (
    <>
      {origin ? (
        <section className="linked-banner" aria-label={t('קריאה מקושרת', 'Linked call')}>
          <strong>
            {origin.kind === 'shared'
              ? t('קריאה משותפת עם חברת ', 'Call shared with ')
              : t('העבודה הגיעה מחברת ', 'Work received from ')}
            {origin.fromCompanyName}
          </strong>{' '}
          <span className="muted">
            ({t('קריאה', 'call')} {ltr(String(origin.parentNumber))}: {origin.parentSubject})
          </span>
          {origin.reason ? (
            <p className="reason">
              {t('סיבה', 'Reason')}: {origin.reason}
            </p>
          ) : null}
          <div className="call-actions">
            <button type="button" onClick={() => setShowEvents(!showEvents)} aria-expanded={showEvents}>
              {showEvents
                ? t('הסתר את אירועי הקריאה המקורית', 'Hide the origin call events')
                : t('הצג את אירועי הקריאה המקורית', 'Show the origin call events')}
            </button>
            {origin.acceptedAt ? (
              <span className="muted">
                {t('ההעברה אושרה', 'Transfer accepted')} {dateText(origin.acceptedAt, true)}
              </span>
            ) : (
              <button type="button" disabled={busy} onClick={() => void run(() => callsApi.acceptLink(callId, origin.linkId))}>
                {t('אישור קבלת העבודה', 'Accept the work')}
              </button>
            )}
          </div>

          {showEvents ? (
            <div className="parent-events" aria-label={t('אירועי הקריאה המקורית', 'Origin call events')}>
              {/* לקריאה בלבד: אין כאן שום כפתור שמשנה את הקריאה של החברה האחרת */}
              {origin.parentEvents.map((event) => (
                <article key={event.id} className={event.kind === 'system' ? 'event system' : 'event'}>
                  <div className="who">
                    {dateText(event.createdAt, true)} · {event.createdByName ?? t('מערכת', 'System')}
                  </div>
                  {event.body}
                </article>
              ))}
              {origin.parentEvents.length === 0 ? <p className="muted">{t('אין אירועים', 'No events')}</p> : null}
            </div>
          ) : null}

          {/* בקשה להעברת הודעה ללקוח — רק אם הקישור מרשה, ורק כבקשה */}
          {origin.relayAllowed ? (
            <div className="relay">
              <label>
                {t('בקשה להעברת הודעה ללקוח (טעונה אישור החברה המקורית)', 'Ask the origin company to pass a message to the customer')}
                <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
              </label>
              <div className="call-actions">
                <select value={channel} onChange={(e) => setChannel(e.target.value === 'whatsapp' ? 'whatsapp' : 'email')}>
                  <option value="email">{t('מייל', 'Email')}</option>
                  <option value="whatsapp">{t('ווטסאפ', 'WhatsApp')}</option>
                </select>
                <button
                  type="button"
                  disabled={busy || !message.trim()}
                  onClick={() =>
                    void run(async () => {
                      await callsApi.requestRelay(callId, { linkId: origin.linkId, body: message, channel });
                      setMessage('');
                    })
                  }
                >
                  {t('שליחת בקשה לאישור', 'Send request for approval')}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {outgoing.length > 0 ? (
        <section className="linked-banner" aria-label={t('עבודה שנשלחה', 'Work sent out')}>
          <strong>{t('נשלחה עבודה לחברות אחרות', 'Work sent to other companies')}</strong>
          <ul>
            {outgoing.map((link) => (
              <li key={link.id}>
                {link.toCompanyName} ·{' '}
                {link.kind === 'shared'
                  ? t('קריאה משותפת', 'Shared call')
                  : link.kind === 'transfer'
                    ? t('העברה', 'Transfer')
                    : t('קריאת בת', 'Child call')}
                {link.childNumber ? ` · ${t('קריאה', 'call')} ${ltr(String(link.childNumber))}` : ''}
                {link.reason ? ` · ${link.reason}` : ''}
                {link.acceptedAt ? ` · ${t('אושרה', 'accepted')}` : ` · ${t('ממתינה לאישור', 'awaiting acceptance')}`}
                {link.pendingRelays > 0 ? ` · ${link.pendingRelays} ${t('בקשות הודעה ממתינות', 'message requests waiting')}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* האישור הוא של נציג מהחברה המקורית; בצד המקבל השורות מוצגות כמצב בלבד */}
      {relays.length > 0 ? (
        <section className="linked-banner" aria-label={t('בקשות להעברת הודעה ללקוח', 'Customer message requests')}>
          <strong>{t('בקשות להעברת הודעה ללקוח', 'Customer message requests')}</strong>
          {relays.map((relay) => (
            <article key={relay.id} className="event">
              <div className="who">
                {dateText(relay.requestedAt, true)} · {relay.fromCompanyName} ·{' '}
                {relay.status === 'pending'
                  ? t('ממתינה לאישור', 'Awaiting approval')
                  : relay.status === 'approved'
                    ? t('אושרה', 'Approved')
                    : t('נדחתה', 'Rejected')}
                {relay.decidedByName ? ` · ${relay.decidedByName}` : ''}
              </div>
              {relay.body}
              {relay.status === 'pending' ? (
                <div className="call-actions">
                  <input
                    placeholder={t('הערה (לא חובה)', 'Note (optional)')}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button type="button" disabled={busy} onClick={() => void run(() => callsApi.approveRelay(relay.id, note))}>
                    {t('אישור ושליחה ללקוח', 'Approve and send to customer')}
                  </button>
                  <button type="button" disabled={busy} onClick={() => void run(() => callsApi.rejectRelay(relay.id, note))}>
                    {t('דחייה', 'Reject')}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          {pending.length === 0 ? null : (
            <p className="muted">{t('אישור הוא פעולה של אדם: שום הודעה לא יוצאת בלעדיו', 'Nothing is sent until a person approves')}</p>
          )}
        </section>
      ) : null}

      {error ? <p className="error" role="alert">{error}</p> : null}
    </>
  );
}
