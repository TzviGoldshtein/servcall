-- ארבע החברות, טבלאות הקוד וברירות המחדל, לפי האפיון.

INSERT INTO companies (code, name, name_en, brand_primary, brand_accent, primary_target, call_seq_next) VALUES
  ('kt',     'קי טלקום',      'K-Telecom',       '#58AE2B', '#00A59E', 4.6, 1),
  ('koriz',  'קוריץ מערכות',  'Koriz Systems',   '#263674', '#EF9D3A', 4.6, 1),
  ('sedcom', 'סדקום',         'Sedcom',          '#5FA5E6', NULL,      4.6, 1),
  ('harel',  'הראל מחשוב',    'Harel Computing', '#1B68B3', NULL,      9.0, 17601);

INSERT INTO departments (name, name_en) VALUES ('מחלקת שרות', 'Service');

INSERT INTO client_groups (name, active) VALUES
  ('AVAYA', true), ('הראל (מחשוב)', true), ('צודקביץ', true),
  ('קבוצת רפק', false), ('קוריץ מערכות (מתח נמוך)', true), ('קי טלקום (טלפוניה)', true);

-- סוגי קריאות
INSERT INTO lookups (kind, name, name_en, sort, std_hours, active) VALUES
  ('call_type','בקשה במייל','Email request',1,NULL,true),
  ('call_type','דיווח תקלה','Fault report',2,NULL,true),
  ('call_type','הודעה בווטסאפ','WhatsApp message',3,NULL,true),
  ('call_type','חלק מפרויקט','Part of a project',4,NULL,true),
  ('call_type','לביצוע','To do',5,NULL,true),
  ('call_type','קריאה טלפונית','Phone call',6,NULL,true),
  ('call_type','תחזוקה שוטפת','Routine maintenance',7,NULL,true);

-- סטטוס קריאה: is_closing מסמן סטטוס שסוגר
INSERT INTO lookups (kind, name, name_en, sort, is_closing, active) VALUES
  ('call_status','פתוחה','Open',1,false,true),
  ('call_status','בטיפול','In progress',2,false,true),
  ('call_status','למעקב','Follow-up',3,false,true),
  ('call_status','לקוח ממתין לשיחה','Customer awaiting call',4,false,true),
  ('call_status','ממתין לתגובת לקוח','Awaiting customer',5,false,true),
  ('call_status','סגורה','Closed',6,true,true),
  ('call_status','היסתדר לבד','Resolved by customer',7,true,true),
  ('call_status','ניסגרה על חוסר מענה מלקוח','Closed – no reply',8,true,true),
  ('call_status','קיימת קריאה דומה בנושא','Duplicate call',9,true,true);

INSERT INTO lookups (kind, name, name_en, sort, active) VALUES
  ('billing_status','הסכם שירות','Service agreement',1,true),
  ('billing_status','לחיוב','Billable',2,true);

-- משך טיפול בדקות
INSERT INTO lookups (kind, name, name_en, sort, minutes, active) VALUES
  ('duration','טרם התחיל','Not started',1,0,true),
  ('duration','לקוח ממתין לשיחה','Customer awaiting call',2,0,true),
  ('duration','15 דקות','15 min',3,15,true),
  ('duration','30 דקות','30 min',4,30,true),
  ('duration','45 דקות','45 min',5,45,true),
  ('duration','60 דקות','60 min',6,60,true),
  ('duration','75 דקות','75 min',7,75,true),
  ('duration','90 דקות','90 min',8,90,true),
  ('duration','120 דקות','120 min',9,120,true),
  ('duration','150 דקות','150 min',10,150,true),
  ('duration','180 דקות','180 min',11,180,true),
  ('duration','210 דקות','210 min',12,210,true),
  ('duration','240 דקות','240 min',13,240,true),
  ('duration','270 דקות','270 min',14,270,true),
  ('duration','300 דקות','300 min',15,300,true),
  ('duration','360 דקות','360 min',16,360,true),
  ('duration','420 דקות','420 min',17,420,true);

INSERT INTO lookups (kind, name, name_en, sort, counts_in_bank, active) VALUES
  ('hour_type','לחיוב','Billable',1,true,true),
  ('hour_type','לא לחיוב','Non-billable',2,false,true);

-- שירותים חודשיים: קטלוג לכל חברה
INSERT INTO items (company_id, name, name_en, price)
SELECT id, 'בנק שעות', 'Hours bank', 0 FROM companies;
INSERT INTO items (company_id, name, name_en, price)
SELECT id, 'רטיינר חודשי', 'Monthly retainer', 5000 FROM companies;

-- פרמטרי מערכת לכל חברה. ההתראות כבויות — אין שליחה לאף אחד עד הפעלה מפורשת.
INSERT INTO settings (company_id, key, value)
SELECT c.id, 'params', jsonb_build_object(
  'defaultStatusNew',      (SELECT id FROM lookups WHERE kind='call_status' AND name='פתוחה'),
  'defaultStatusClose',    (SELECT id FROM lookups WHERE kind='call_status' AND name='סגורה'),
  'signatureDefaultText',  'מאשר ביצוע לשביעות רצוני',
  'listShowOnlyOpen',      true,
  'listShowTime',          true,
  'listDescending',        true,
  'markDelayMinutes',      0,
  'requireCallType',       true,
  'requireDetails',        false,
  'requireBillingStatus',  false,
  'requireDuration',       true,
  'sendRemarksLog',        true,
  'contactCanOnlyOpen',    false,
  'idleLogoutMinutes',     45
) FROM companies c;

-- ברירת מחדל להתראות: כלום
INSERT INTO notify_prefs (company_id, client_id, email, whatsapp)
SELECT id, NULL, false, false FROM companies;
