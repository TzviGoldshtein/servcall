-- אינדקסים לדו"חות. אין כאן שינוי סכמה: הטבלאות, העמודות והאילוצים נשארים
-- בדיוק כפי שהם ב-001. מה שמתווסף הוא מסלולי קריאה לשאילתות שהדו"חות עושים
-- שוב ושוב, כולן מתחילות ב-company_id.

-- דו"ח דיווח שעות ובנק שעות: סינון לפי חברה ועובד מדווח בטווח תאריכים
CREATE INDEX IF NOT EXISTS call_hours_reporter_idx
  ON call_hours (company_id, reporter_id, work_date);

-- יתרת בנק שעות: סכום השעות שנזקפו לבנק מסוים
CREATE INDEX IF NOT EXISTS call_hours_bank_idx
  ON call_hours (hours_bank_id, company_id)
  WHERE hours_bank_id IS NOT NULL;

-- דו"ח התפלגות: ספירה לפי סטטוס, סוג ומשך בתוך החברה
CREATE INDEX IF NOT EXISTS calls_company_status_idx
  ON service_calls (company_id, status_id);
CREATE INDEX IF NOT EXISTS calls_company_type_idx
  ON service_calls (company_id, type_id);

-- "קריאות פתוחות" של לקוח בחברה — רשימת הלקוחות וכרטיס הלקוח שואלים את זה
-- לכל שורה, ולכן זה הזוג שמשרת אותם
CREATE INDEX IF NOT EXISTS calls_company_client_idx
  ON service_calls (company_id, client_id);

-- בנק שעות ושירותים חודשיים: תמיד נקראים לפי חברה ולקוח
CREATE INDEX IF NOT EXISTS hours_banks_company_client_idx
  ON hours_banks (company_id, client_id);
CREATE INDEX IF NOT EXISTS client_items_company_client_idx
  ON client_items (company_id, client_id)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS client_items_item_idx
  ON client_items (company_id, item_id)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS items_company_idx
  ON items (company_id, active);
