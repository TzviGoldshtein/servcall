/*
 * שליחת עבודה לחברה אחרת בקבוצה.
 *
 * שתי צורות, וברירת המחדל היא קריאת בת — כי כל חברה מחייבת בנפרד:
 *   קריאת בת  — קריאה חדשה ונפרדת בחברה המקבלת, עם מספר, שעות וחיוב משלה.
 *                הקריאה הנוכחית נשארת פתוחה ומקושרת.
 *   משותפת    — קריאה אחת ששתי החברות רואות ומעדכנות; השעות נושאות את החברה
 *                המדווחת.
 *   העברה     — קריאת בת, ועוד סגירת הקריאה הנוכחית.
 *
 * שדות החובה הם של *החברה המקבלת* (כל חברה והפרמטרים שלה), ולכן הטופס מבקש
 * בדיוק את מה שהיא דורשת, ומסמן את זה בכוכבית.
 */
import { useEffect, useState } from 'react';
import { byKind, callsApi, t, type LinkKind, type TransferTarget } from './callsApi';
import './calls.css';

export function TransferDialog({
  callId,
  onClose,
  onDone,
}: {
  callId: number;
  onClose(): void;
  onDone?(result: { kind: LinkKind; childCallId: number | null; childNumber: number | null }): void;
}) {
  const [targets, setTargets] = useState<TransferTarget[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [kind, setKind] = useState<LinkKind>('child');
  const [reason, setReason] = useState('');
  const [relayAllowed, setRelayAllowed] = useState(false);
  const [subject, setSubject] = useState('');
  const [typeId, setTypeId] = useState('');
  const [billingStatusId, setBillingStatusId] = useState('');
  const [durationId, setDurationId] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    callsApi
      .targets(callId)
      .then((list) => {
        setTargets(list);
        setCompanyId(list[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('שגיאה', 'Error')));
  }, [callId]);

  const target = targets.find((c) => c.id === companyId);
  const params = target?.params;
  const needsCallFields = kind !== 'shared';

  const submit = async () => {
    if (!companyId) return;
    setBusy(true);
    setError('');
    try {
      const result = await callsApi.link(callId, {
        kind,
        toCompanyId: companyId,
        reason: reason || null,
        relayAllowed,
        ...(needsCallFields
          ? {
              subject: subject || null,
              typeId: typeId ? Number(typeId) : null,
              billingStatusId: billingStatusId ? Number(billingStatusId) : null,
              durationId: durationId ? Number(durationId) : null,
              ownerUserId: ownerUserId ? Number(ownerUserId) : null,
            }
          : {}),
      });
      onDone?.(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('שגיאה', 'Error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('שליחת עבודה לחברה אחרת', 'Send work to another company')}>
        <header>
          <h2>{t('שליחת עבודה לחברה אחרת', 'Send work to another company')}</h2>
          <button className="icon" onClick={onClose} aria-label={t('סגור', 'Close')}>
            ✕
          </button>
        </header>
        <div className="modal-body call-fields">
          <label>
            {t('חברה מקבלת', 'Receiving company')}
            <select value={companyId ?? ''} onChange={(e) => setCompanyId(Number(e.target.value) || null)}>
              {targets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t('צורת ההעברה', 'Transfer shape')}
            <select value={kind} onChange={(e) => setKind(e.target.value as LinkKind)}>
              <option value="child">{t('קריאת בת — חיוב נפרד (ברירת מחדל)', 'Child call — separate billing (default)')}</option>
              <option value="shared">{t('קריאה משותפת — שתי החברות מעדכנות', 'Shared call — both companies update it')}</option>
              <option value="transfer">{t('העברה — קריאת בת וסגירת הקריאה הנוכחית', 'Transfer — child call, and close this one')}</option>
            </select>
          </label>

          <label className="wide">
            {t('סיבת ההעברה (מוצגת לחברה המקבלת)', 'Reason (shown to the receiving company)')}
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>

          <label className="wide">
            <input type="checkbox" checked={relayAllowed} onChange={(e) => setRelayAllowed(e.target.checked)} />{' '}
            {t(
              'החברה המקבלת רשאית לבקש העברת הודעה ללקוח (באישור נציג שלנו)',
              'The receiving company may request a message to the customer (our agent approves)',
            )}
          </label>

          {needsCallFields && target ? (
            <>
              <label className="wide">
                {t('נושא הקריאה בחברה המקבלת', 'Subject in the receiving company')}
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={t('ברירת מחדל: נושא הקריאה הנוכחית', 'Default: this call subject')}
                />
              </label>
              <label className={params?.requireCallType ? 'required' : undefined}>
                {t('סוג קריאה', 'Call type')}
                <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                  <option value="">{t('ללא', 'None')}</option>
                  {byKind(target.lookups, 'call_type').map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={params?.requireBillingStatus ? 'required' : undefined}>
                {t('סטטוס חיוב', 'Billing status')}
                <select value={billingStatusId} onChange={(e) => setBillingStatusId(e.target.value)}>
                  <option value="">{t('ללא', 'None')}</option>
                  {byKind(target.lookups, 'billing_status').map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={params?.requireDuration ? 'required' : undefined}>
                {t('משך טיפול', 'Duration')}
                <select value={durationId} onChange={(e) => setDurationId(e.target.value)}>
                  <option value="">{t('ללא', 'None')}</option>
                  {byKind(target.lookups, 'duration').map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('גורם מטפל בחברה המקבלת', 'Owner in the receiving company')}
                <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
                  <option value="">{t('ללא', 'Unassigned')}</option>
                  {target.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name ?? a.id}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted wide">
                {t(
                  'לקריאת הבת יוקצה מספר מהרצף של החברה המקבלת, והשעות והחיוב שלה נפרדים.',
                  'The child call gets a number from the receiving company sequence, with its own hours and billing.',
                )}
              </p>
            </>
          ) : null}

          {kind === 'transfer' ? (
            <p className="muted wide">
              {t('הקריאה הנוכחית תיסגר בסיום ההעברה.', 'This call will be closed once the transfer is made.')}
            </p>
          ) : null}

          {error ? <p className="error wide" role="alert">{error}</p> : null}
        </div>
        <div className="call-actions">
          <button type="button" disabled={busy || !companyId} onClick={() => void submit()}>
            {kind === 'shared' ? t('שיתוף הקריאה', 'Share the call') : t('שליחת העבודה', 'Send the work')}
          </button>
          <button type="button" onClick={onClose}>
            {t('ביטול', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
