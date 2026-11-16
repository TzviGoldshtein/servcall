import { api, companyLabel, type CompanyOption, type Lang, type Me } from './api';
import { roleLabel, t } from './i18n';
import { ErrorText, useAction } from './ui';

/**
 * בחירת החברה שבה הנציג יעבוד עכשיו. כל כרטיס נושא את הצבע והלוגו של החברה שלו
 * ולא של החברה הפעילה — זו הנקודה היחידה שבה כל הערכות נראות זו לצד זו.
 */
export function CompanyPicker({
  lang,
  companies,
  onPicked,
}: {
  lang: Lang;
  companies: CompanyOption[];
  onPicked(me: Me): void;
}) {
  const { run, error, busy } = useAction();

  const pick = async (companyId: number) => {
    const me = await run(() => api.post<Me>('/api/auth/company', { companyId }));
    if (me) onPicked(me);
  };

  return (
    <main className="centered">
      <div className="card wide">
        <h1>{t(lang, 'pickCompany')}</h1>
        <p className="muted">{t(lang, 'pickCompanyHint')}</p>
        <ErrorText>{error}</ErrorText>
        {companies.length === 0 ? (
          <p className="notice">{t(lang, 'noCompany')}</p>
        ) : (
          <div className="company-grid">
            {companies.map((company) => (
              <button
                key={company.id}
                className="company-card"
                // הצבע הגולמי של החברה, לא הנגזר: זה מה שמזהים ממנו את הלוגו
                style={{ '--card-brand': company.brandPrimary } as React.CSSProperties}
                disabled={busy}
                onClick={() => void pick(company.id)}
              >
                {company.logoUrl ? (
                  <img className="logo" src={company.logoUrl} alt="" />
                ) : (
                  <span className="swatch" aria-hidden />
                )}
                <span className="name">{companyLabel(company, lang)}</span>
                <span className="muted">{roleLabel(lang, company.role)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
