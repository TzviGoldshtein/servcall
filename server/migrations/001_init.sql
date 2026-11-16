-- ServCall — סכמת בסיס.
-- הכלל המרכזי: לקוחות ואנשי קשר משותפים לכל החברות; קריאות, שעות וחיוב פר חברה.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- החברות שלנו ----------
CREATE TABLE companies (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE,            -- kt | koriz | sedcom | harel
  name            text NOT NULL,
  name_en         text,
  brand_primary   text NOT NULL,                   -- צבע הכרום: באנר, רקע, כותרות
  brand_accent    text,                            -- כפתורים, חיצים, מפרידים. NULL = מונוכרום
  primary_target  numeric(3,1) NOT NULL DEFAULT 4.6, -- יעד ניגודיות לגזירת ה-primary
  logo_path       text,
  logo_mark_path  text,
  wa_account_id   int,                             -- accounts.id אצל wa-team
  call_seq_next   int NOT NULL DEFAULT 1,          -- המספר הבא לקריאה בחברה הזו
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- אנשים ----------
CREATE TABLE departments (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  name_en       text,
  manager_id    int,
  active        boolean NOT NULL DEFAULT true
);

-- זהות אחת לאדם, גם כשהוא עובד בכמה חברות
CREATE TABLE users (
  id             serial PRIMARY KEY,
  email          text NOT NULL,
  username       text,
  first_name     text NOT NULL,
  last_name      text,
  password_hash  text,
  lang           text NOT NULL DEFAULT 'he' CHECK (lang IN ('he','en')),
  is_superadmin  boolean NOT NULL DEFAULT false,
  totp_secret    bytea,                            -- 2FA, מוצפן
  prefs          jsonb NOT NULL DEFAULT '{}',
  last_company_id int REFERENCES companies(id) ON DELETE SET NULL,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));
CREATE UNIQUE INDEX users_username_idx ON users (lower(username)) WHERE username IS NOT NULL;

-- השיוך נושא את ההפרדה: שלוחה, טלפון, הרשאה ומזהה הנה"ח נפרדים בכל חברה
CREATE TABLE user_companies (
  user_id           int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id        int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('admin','agent','opener','viewer')),
  extension         text,
  phone             text,
  mobile            text,
  email             text,
  recipients_email  text,
  department_id     int REFERENCES departments(id) ON DELETE SET NULL,
  external_id       text,                          -- מזהה בהנה"ח של אותה חברה
  notify_when_owner boolean NOT NULL DEFAULT false,
  active            boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, company_id)
);
CREATE INDEX user_companies_company_idx ON user_companies (company_id);
ALTER TABLE departments ADD CONSTRAINT departments_manager_fk
  FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL;

-- כניסה דרך ווטסאפ צוות: לאותו אדם יכולות להיות כמה זהויות ווטסאפ
CREATE TABLE user_wa_identities (
  wa_account_id int NOT NULL,
  wa_user_id    int NOT NULL,
  user_id       int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wa_account_id, wa_user_id)
);
CREATE INDEX user_wa_identities_user_idx ON user_wa_identities (user_id);

CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id   int REFERENCES companies(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- ---------- הלקוחות: משותפים לכל החברות ----------
CREATE TABLE client_groups (
  id       serial PRIMARY KEY,
  name     text NOT NULL,
  manager  text,
  active   boolean NOT NULL DEFAULT true
);

CREATE TABLE clients (
  id          serial PRIMARY KEY,
  group_id    int REFERENCES client_groups(id) ON DELETE SET NULL,
  name        text NOT NULL,                       -- שם הלקוח, מה-CRM. זה השם הקובע
  vat_id      text,
  phone       text,
  phone2      text,
  mobile      text,
  fax         text,
  city        text,
  street      text,
  house_no    text,
  apartment   text,
  zip         text,
  po_box      text,
  link_url    text,
  external_id text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  int REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz,
  updated_by  int REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX clients_name_trgm ON clients USING gin (name gin_trgm_ops);
CREATE INDEX clients_group_idx ON clients (group_id);

-- מה שכן שונה בין חברה לחברה על אותו לקוח
CREATE TABLE client_company_settings (
  client_id        int NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  company_id       int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  call_remarks     text,                           -- ההערה האדומה בטופס הקריאה
  default_owner_id int REFERENCES users(id) ON DELETE SET NULL,
  hour_cost        numeric(10,2),
  offline          boolean NOT NULL DEFAULT false, -- לא מקבל מיילים/ווטסאפ
  active           boolean NOT NULL DEFAULT true,
  PRIMARY KEY (client_id, company_id)
);

CREATE TABLE contacts (
  id            serial PRIMARY KEY,
  client_id     int NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  first_name    text NOT NULL,
  last_name     text,
  google_name   text,                              -- מאנשי הקשר של גוגל
  national_id   text,
  mobile        text,
  mobile_e164   text,                              -- מנורמל, לזיהוי לפי טלפון מווטסאפ
  phone         text,
  phone2        text,
  fax           text,
  email         text,
  position      text,
  username      text,
  password_hash text,
  read_only     boolean NOT NULL DEFAULT false,
  external_id   text,
  active        boolean NOT NULL DEFAULT true
);
CREATE INDEX contacts_client_idx ON contacts (client_id);
CREATE INDEX contacts_e164_idx ON contacts (mobile_e164) WHERE mobile_e164 IS NOT NULL;

-- ---------- טבלאות קוד ----------
-- company_id NULL = ערך משותף לכל החברות
CREATE TABLE lookups (
  id             serial PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN
                   ('call_type','call_status','billing_status','duration','hour_type','service_type')),
  company_id     int REFERENCES companies(id) ON DELETE CASCADE,
  name           text NOT NULL,
  name_en        text,
  sort           int NOT NULL DEFAULT 0,
  is_closing     boolean,                          -- call_status: סוגר קריאה
  minutes        int,                              -- duration
  department_id  int REFERENCES departments(id) ON DELETE SET NULL,
  counts_in_bank boolean,                          -- hour_type: נספר בבנק שעות
  std_hours      numeric(6,2),                     -- call_type: תקן שעות לטיפול
  price          numeric(10,2),
  active         boolean NOT NULL DEFAULT true
);
CREATE INDEX lookups_kind_idx ON lookups (kind, company_id, sort);

-- ---------- קריאות שירות: פר חברה ----------
CREATE TABLE service_calls (
  id                bigserial PRIMARY KEY,
  company_id        int NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number            int NOT NULL,
  client_id         int NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  contact_id        int REFERENCES contacts(id) ON DELETE SET NULL,
  owner_user_id     int REFERENCES users(id) ON DELETE SET NULL,
  subject           text NOT NULL,
  details           text,
  type_id           int REFERENCES lookups(id) ON DELETE SET NULL,
  status_id         int NOT NULL REFERENCES lookups(id) ON DELETE RESTRICT,
  billing_status_id int REFERENCES lookups(id) ON DELETE SET NULL,
  duration_id       int REFERENCES lookups(id) ON DELETE SET NULL,
  open_at           timestamptz NOT NULL DEFAULT now(),
  open_by           int REFERENCES users(id) ON DELETE SET NULL,
  updated_at        timestamptz,
  updated_by        int REFERENCES users(id) ON DELETE SET NULL,
  closed_at         timestamptz,
  closed_by         int REFERENCES users(id) ON DELETE SET NULL,
  source            text NOT NULL DEFAULT 'web' CHECK (source IN ('web','whatsapp','email','portal','import')),
  UNIQUE (company_id, number)
);
CREATE INDEX calls_company_open_idx ON service_calls (company_id, open_at DESC);
CREATE INDEX calls_client_idx ON service_calls (client_id);
CREATE INDEX calls_owner_idx ON service_calls (company_id, owner_user_id);
CREATE INDEX calls_subject_trgm ON service_calls USING gin (subject gin_trgm_ops);

CREATE TABLE call_events (
  id         bigserial PRIMARY KEY,
  call_id    bigint NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
  body       text,
  kind       text NOT NULL DEFAULT 'note' CHECK (kind IN ('note','system','email','whatsapp')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  emailed_to text,
  wa_message_id text
);
CREATE INDEX call_events_call_idx ON call_events (call_id, created_at);

CREATE TABLE call_hours (
  id           bigserial PRIMARY KEY,
  call_id      bigint NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
  company_id   int NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  work_date    date NOT NULL,
  reporter_id  int REFERENCES users(id) ON DELETE SET NULL,
  from_time    time,
  to_time      time,
  hours        numeric(6,2) NOT NULL,
  hour_price   numeric(10,2) NOT NULL DEFAULT 0,
  description  text NOT NULL,
  hour_type_id int REFERENCES lookups(id) ON DELETE SET NULL,
  hours_bank_id int,
  auto         boolean NOT NULL DEFAULT false,     -- נוצר ממשך הטיפול
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_hours_call_idx ON call_hours (call_id);
CREATE INDEX call_hours_company_date_idx ON call_hours (company_id, work_date);

CREATE TABLE call_files (
  id          bigserial PRIMARY KEY,
  call_id     bigint NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
  description text,
  file_path   text NOT NULL,
  file_name   text,
  mime        text,
  size        bigint,
  uploaded_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE call_signatures (
  id          bigserial PRIMARY KEY,
  call_id     bigint NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
  description text,
  signer_name text NOT NULL,
  remarks     text,
  image_path  text NOT NULL,
  signed_at   timestamptz NOT NULL DEFAULT now()
);

-- העברת עבודה בין חברות: קריאת בת או קריאה משותפת
CREATE TABLE call_links (
  id             bigserial PRIMARY KEY,
  parent_call_id bigint NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
  child_call_id  bigint REFERENCES service_calls(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('child','shared','transfer')),
  to_company_id  int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  relay_allowed  boolean NOT NULL DEFAULT false,   -- החברה המקבלת רשאית לבקש העברת הודעה ללקוח
  reason         text,
  created_by     int REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  accepted_by    int REFERENCES users(id) ON DELETE SET NULL,
  accepted_at    timestamptz
);
CREATE INDEX call_links_parent_idx ON call_links (parent_call_id);
CREATE INDEX call_links_child_idx ON call_links (child_call_id);

-- ---------- בנק שעות ושירותים חודשיים ----------
CREATE TABLE hours_banks (
  id         serial PRIMARY KEY,
  client_id  int NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       text NOT NULL,
  hours      numeric(8,2) NOT NULL DEFAULT 0,      -- נרכשו. היתרה מחושבת מול call_hours
  active     boolean NOT NULL DEFAULT true
);
ALTER TABLE call_hours ADD CONSTRAINT call_hours_bank_fk
  FOREIGN KEY (hours_bank_id) REFERENCES hours_banks(id) ON DELETE SET NULL;

CREATE TABLE items (
  id         serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       text NOT NULL,
  name_en    text,
  price      numeric(10,2) NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE client_items (
  id         serial PRIMARY KEY,
  client_id  int NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id    int NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  cost       numeric(10,2) NOT NULL DEFAULT 0,     -- 0 = לפי מחיר הקטלוג
  qty        numeric(8,2) NOT NULL DEFAULT 1,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz,
  updated_by int REFERENCES users(id) ON DELETE SET NULL,
  removed_at timestamptz,
  removed_by int REFERENCES users(id) ON DELETE SET NULL
);

-- ---------- הערות: שני סוגים ----------
CREATE TABLE notes (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('card','sticky')),
  client_id  int REFERENCES clients(id) ON DELETE CASCADE,
  call_id    bigint REFERENCES service_calls(id) ON DELETE CASCADE,
  company_id int REFERENCES companies(id) ON DELETE CASCADE,
  body       text NOT NULL,
  author_id  int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz,
  -- דביקות בלבד
  pinned_for int REFERENCES users(id) ON DELETE CASCADE,
  due_at     timestamptz,
  done_at    timestamptz,
  done_by    int REFERENCES users(id) ON DELETE SET NULL,
  mentions   int[] NOT NULL DEFAULT '{}',
  CHECK (kind <> 'sticky' OR pinned_for IS NOT NULL),
  CHECK (client_id IS NOT NULL OR call_id IS NOT NULL)
);
CREATE INDEX notes_client_idx ON notes (client_id, kind, created_at DESC);
CREATE INDEX notes_sticky_idx ON notes (pinned_for, due_at) WHERE kind = 'sticky' AND done_at IS NULL;

-- ---------- הגדרות, התראות, יומן ----------
CREATE TABLE settings (
  company_id int REFERENCES companies(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);

-- ברירת המחדל היא כלום. אף התראה לא יוצאת עד שמפעילים במפורש.
CREATE TABLE notify_prefs (
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id  int REFERENCES clients(id) ON DELETE CASCADE,   -- NULL = ברירת המחדל של החברה
  email      boolean NOT NULL DEFAULT false,
  whatsapp   boolean NOT NULL DEFAULT false,
  UNIQUE (company_id, client_id)
);

CREATE TABLE outbox (
  id          bigserial PRIMARY KEY,
  company_id  int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('email','whatsapp')),
  call_id     bigint REFERENCES service_calls(id) ON DELETE CASCADE,
  to_address  text NOT NULL,
  subject     text,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','blocked')),
  attempts    int NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox (created_at) WHERE status = 'pending';

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  company_id int REFERENCES companies(id) ON DELETE SET NULL,
  user_id    int REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target     text,
  detail     jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_time_idx ON audit_log (created_at DESC);
