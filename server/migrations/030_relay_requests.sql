-- בקשת העברת הודעה ללקוח (relay).
--
-- כשחברה מקבלת עבודה מחברה אחרת (call_links) היא לא מדברת עם הלקוח בעצמה:
-- הלקוח שייך לחברה שפתחה את הקריאה. אם הקישור נושא relay_allowed, החברה
-- המקבלת רשאית *לבקש* שהודעה תועבר ללקוח, והבקשה ממתינה לאישור נציג של
-- החברה המקורית. שום דבר לא נשלח מעצמו: אישור הוא פעולה של אדם, ורק הוא
-- מכניס שורה ל-outbox.
CREATE TABLE call_relay_requests (
  id              bigserial PRIMARY KEY,
  link_id         bigint NOT NULL REFERENCES call_links(id) ON DELETE CASCADE,
  -- הקריאה שממנה נשלחה הבקשה (הבת, או המשותפת) — לתיעוד ולהצגה
  call_id         bigint NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
  from_company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  body            text NOT NULL,
  channel         text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','whatsapp')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by    int REFERENCES users(id) ON DELETE SET NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      int REFERENCES users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_note   text,
  outbox_id       bigint REFERENCES outbox(id) ON DELETE SET NULL
);
CREATE INDEX call_relay_requests_link_idx ON call_relay_requests (link_id);
CREATE INDEX call_relay_requests_pending_idx ON call_relay_requests (requested_at)
  WHERE status = 'pending';
