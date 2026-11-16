import { basename } from 'node:path';
import type { Db } from './db.ts';
import { deriveTheme, themeToCssVars, type ThemeNote } from './theme.ts';

/**
 * המיתוג שהדפדפן מקבל על חברה.
 *
 * הצבעים נגזרים כאן ולא בדפדפן, וגם לא מוזנים בו ביד: אפליקציית הווב לא מכירה
 * שום צבע מותג, רק את משתני ה-CSS שנשלחים לה. כך החלפת חברה היא החלפת טוקנים,
 * והוספת חברה חמישית אינה נוגעת בקוד הצד-לקוח.
 *
 * שני הסטים (בהיר וכהה) נשלחים יחד, כי מצב כהה הוא בחירה של המשתמש בדפדפן ולא
 * של השרת, ולא נרצה סיבוב נוסף לשרת כשהוא מחליף מצב.
 */
export interface CompanyBrand {
  id: number;
  code: string;
  name: string;
  nameEn: string | null;
  /** הצבע הגולמי של החברה. לשימוש בנקודות שבהן רוצים את הצבע עצמו, כמו נקודת צבע בבורר. */
  brandPrimary: string;
  brandAccent: string | null;
  primaryTarget: number;
  logoUrl: string | null;
  logoMarkUrl: string | null;
  theme: {
    light: Record<string, string>;
    dark: Record<string, string>;
    /** הערות הגזירה (צבע ללא גוון, הזזה גדולה) — כדי שמסך המיתוג יוכל להזהיר. */
    notes: ThemeNote[];
  };
}

export interface CompanyRow {
  id: number;
  code: string;
  name: string;
  name_en: string | null;
  brand_primary: string;
  brand_accent: string | null;
  primary_target: number;
  logo_path: string | null;
  logo_mark_path: string | null;
}

export const COMPANY_COLUMNS =
  'id, code, name, name_en, brand_primary, brand_accent, primary_target, logo_path, logo_mark_path';

/** הכתובת נשארת קבועה; שם הקובץ נכנס כגרסה כדי שהחלפת לוגו תעקוף את המטמון. */
const assetUrl = (companyId: number, kind: 'logo' | 'logo-mark', path: string | null): string | null =>
  path ? `/api/companies/${companyId}/${kind}?v=${encodeURIComponent(basename(path))}` : null;

export function brandOf(row: CompanyRow): CompanyBrand {
  const input = {
    primary: row.brand_primary,
    accent: row.brand_accent,
    primaryTarget: Number(row.primary_target),
  };
  const light = deriveTheme(input, false);
  const dark = deriveTheme(input, true);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameEn: row.name_en,
    brandPrimary: row.brand_primary,
    brandAccent: row.brand_accent,
    primaryTarget: Number(row.primary_target),
    logoUrl: assetUrl(row.id, 'logo', row.logo_path),
    logoMarkUrl: assetUrl(row.id, 'logo-mark', row.logo_mark_path),
    theme: {
      light: themeToCssVars(light),
      dark: themeToCssVars(dark),
      // הערות הגזירה זהות בשני המצבים כשהצבע תקין; אוחדו כדי לא להציג אותן פעמיים
      notes: [...new Set([...light.notes, ...dark.notes])],
    },
  };
}

export async function brandsOf(db: Db, companyIds: number[]): Promise<Map<number, CompanyBrand>> {
  if (!companyIds.length) return new Map();
  const { rows } = await db.query<CompanyRow>(
    `SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = ANY($1::int[]) AND active ORDER BY id`,
    [companyIds],
  );
  return new Map(rows.map((row) => [row.id, brandOf(row)]));
}

export async function brandOfCompany(db: Db, companyId: number): Promise<CompanyBrand | undefined> {
  const { rows } = await db.query<CompanyRow>(
    `SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = $1 AND active`,
    [companyId],
  );
  return rows[0] ? brandOf(rows[0]) : undefined;
}
