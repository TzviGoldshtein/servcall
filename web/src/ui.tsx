import { useState } from 'react';

/**
 * מריץ פעולה ומחזיק את הכשל שלה כטקסט להצגה ליד הפקד, ודגל `busy` לנטרולו.
 * הודעת השגיאה היא זו שהשרת שלח — הוא זה שיודע לנסח אותה בשפת המשתמש.
 */
export function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setError('');
    setBusy(true);
    try {
      return await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return { run, error, busy, clearError: () => setError('') };
}

export function ErrorText({ children }: { children: string }) {
  return children ? (
    <p className="error" role="alert">
      {children}
    </p>
  ) : null;
}
