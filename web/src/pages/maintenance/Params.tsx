import { useState } from 'react';
import { api } from '../../api';
import { ErrorText, Field, s, Toggle, useAction, useLang, useLoad } from './shared';

/**
 * פרמטרי המערכת של החברה. במכוון זה לא גריד של key/value אלא מסך הגדרות:
 * קבוצות נושא, ובכל שורה מתג אחד עם הסבר בשורה אחת — כדי שמנהל יבין מה הוא
 * משנה בלי לקרוא תיעוד. הקבוצות, התוויות וההסברים מגיעים מהשרת בשפת המשתמש.
 *
 * הערכים שייכים לחברה שאתה עובד בה כרגע. אותה מערכת, חברה אחרת — פרמטרים אחרים.
 * נשמרים רק הפרמטרים שנגעת בהם, והשרת דוחה מפתח שאינו מוכר לו.
 */

type ParamValue = boolean | number | string | null;

interface ParamFieldInfo {
  key: string;
  group: string;
  type: 'bool' | 'int' | 'text' | 'lookup';
  label: string;
  help: string;
  lookupKind: string | null;
  closingOnly: boolean;
  min: number | null;
  max: number | null;
}

interface ParamsPayload {
  values: Record<string, ParamValue>;
  groups: { group: string; label: string }[];
  fields: ParamFieldInfo[];
}

interface LookupOption {
  id: number;
  label: string;
  isClosing: boolean | null;
}

export default function Params() {
  const { tx } = useLang();
  const [draft, setDraft] = useState<Record<string, ParamValue>>({});
  const [saved, setSaved] = useState(false);
  const data = useLoad(() => api.get<ParamsPayload>('/api/params'), []);
  const statuses = useLoad(() => api.get<LookupOption[]>('/api/lookups?kind=call_status'), []);
  const { run, error, busy } = useAction();

  const values = { ...(data.data?.values ?? {}), ...draft };
  const dirty = Object.keys(draft);
  const set = (key: string, value: ParamValue) => {
    setSaved(false);
    setDraft({ ...draft, [key]: value });
  };

  async function save() {
    if (!dirty.length) return;
    const only: Record<string, ParamValue> = {};
    for (const key of dirty) only[key] = values[key] ?? null;
    const done = await run(() => api.put<{ values: Record<string, ParamValue>; changed: string[] }>('/api/params', { values: only }));
    if (!done) return;
    setDraft({});
    setSaved(true);
    await data.reload();
  }

  function control(field: ParamFieldInfo) {
    const value = values[field.key];
    if (field.type === 'bool') {
      return (
        <Toggle
          key={field.key}
          label={field.label}
          help={field.help}
          checked={value === true}
          disabled={busy}
          onChange={(next) => set(field.key, next)}
        />
      );
    }
    if (field.type === 'lookup') {
      const options = (statuses.data ?? []).filter((o) => !field.closingOnly || o.isClosing);
      return (
        <div key={field.key} style={{ padding: '6px 0' }}>
          <Field label={field.label}>
            <select
              style={s.input}
              value={(value as number | null) ?? ''}
              disabled={busy}
              onChange={(e) => set(field.key, e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{tx('ללא', 'None')}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <span style={{ ...s.hint, display: 'block' }}>{field.help}</span>
        </div>
      );
    }
    if (field.type === 'int') {
      return (
        <div key={field.key} style={{ padding: '6px 0' }}>
          <Field label={field.label}>
            <input
              style={{ ...s.input, maxWidth: 140 }}
              type="number"
              dir="ltr"
              min={field.min ?? 0}
              max={field.max ?? undefined}
              value={(value as number | null) ?? ''}
              disabled={busy}
              onChange={(e) => set(field.key, e.target.value === '' ? null : Number(e.target.value))}
            />
          </Field>
          <span style={{ ...s.hint, display: 'block' }}>{field.help}</span>
        </div>
      );
    }
    return (
      <div key={field.key} style={{ padding: '6px 0' }}>
        <Field label={field.label} wide>
          <input
            style={s.input}
            value={(value as string | null) ?? ''}
            disabled={busy}
            onChange={(e) => set(field.key, e.target.value)}
            maxLength={300}
          />
        </Field>
        <span style={{ ...s.hint, display: 'block' }}>{field.help}</span>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.head}>
        <h2 style={{ ...s.title, flex: 1 }}>{tx('פרמטרים', 'Parameters')}</h2>
        {saved && <span style={s.badge}>{tx('נשמר', 'Saved')}</span>}
        <button type="button" style={s.primary} onClick={() => void save()} disabled={busy || !dirty.length}>
          {dirty.length ? tx(`שמירת ${dirty.length} שינויים`, `Save ${dirty.length} changes`) : tx('שמירה', 'Save')}
        </button>
      </div>
      <p style={s.hint}>
        {tx(
          'ההגדרות כאן שייכות לחברה שאתה עובד בה כרגע, ואינן משפיעות על החברות האחרות בקבוצה.',
          'These settings belong to the company you are working in and do not affect the other companies in the group.',
        )}
      </p>
      <ErrorText>{error || data.error || ''}</ErrorText>

      {(data.data?.groups ?? []).map((group) => {
        const fields = (data.data?.fields ?? []).filter((f) => f.group === group.group);
        if (!fields.length) return null;
        return (
          <section key={group.group} style={s.card}>
            <strong>{group.label}</strong>
            {fields.map(control)}
          </section>
        );
      })}

      {dirty.length > 0 && (
        <div style={s.row}>
          <button type="button" style={s.button} onClick={() => setDraft({})} disabled={busy}>
            {tx('ביטול השינויים', 'Discard changes')}
          </button>
        </div>
      )}
    </div>
  );
}
