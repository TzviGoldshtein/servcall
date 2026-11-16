/**
 * שגיאה שההודעה שלה מוצגת למשתמש כמו שהיא (כלומר: בעברית).
 * השדה נכתב במפורש ולא דרך `public status` בקונסטרקטור, כי המריץ של נוד
 * (`--experimental-strip-types`) מסיר טיפוסים בלבד ואינו תומך בתחביר הזה.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const badRequest = (m: string) => new HttpError(400, m);
export const forbidden = (m: string) => new HttpError(403, m);
export const notFound = (m: string) => new HttpError(404, m);
