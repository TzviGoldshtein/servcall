/*
 * Types and helpers for the service-call pages. The types mirror the server's read
 * models in server/src/routes/*.ts — when a column changes there, it changes here.
 *
 * `api` comes from the app shell (web/src/api.ts): api.get / post / patch / del,
 * each parsing the JSON answer and throwing an Error with the server's Hebrew
 * message when the request fails.
 */
import { api } from '../../api';

export type Lang = 'he' | 'en';

/** The shell sets <html lang>; the labels below follow it without owning the language. */
export const lang = (): Lang => (document.documentElement.lang === 'en' ? 'en' : 'he');

/** A label in both languages. Hebrew is the working language, so it comes first. */
export const t = (he: string, en: string): string => (lang() === 'en' ? en : he);

// ---------------------------------------------------------------- read models

export interface CallParams {
  defaultStatusNew: number | null;
  defaultStatusClose: number | null;
  signatureDefaultText: string;
  listShowOnlyOpen: boolean;
  listShowTime: boolean;
  listDescending: boolean;
  markDelayMinutes: number;
  requireCallType: boolean;
  requireDetails: boolean;
  requireBillingStatus: boolean;
  requireDuration: boolean;
  sendRemarksLog: boolean;
  contactCanOnlyOpen: boolean;
}

export type LookupKind = 'call_type' | 'call_status' | 'billing_status' | 'duration' | 'hour_type' | 'service_type';

export interface Lookup {
  id: number;
  kind: LookupKind;
  name: string;
  sort: number;
  isClosing: boolean | null;
  minutes: number | null;
  stdHours: number | null;
  countsInBank: boolean | null;
}

export interface Agent {
  id: number;
  name: string | null;
  role?: string;
}

export interface CompanyRef {
  id: number;
  code: string;
  name: string;
  nameEn?: string | null;
}

export interface CallMeta {
  params: CallParams;
  lookups: Lookup[];
  agents: Agent[];
  companies: CompanyRef[];
  pageSize: number;
}

export interface CallListRow {
  id: number;
  number: number;
  companyId: number;
  shared: boolean;
  clientId: number;
  clientName: string;
  contactId: number | null;
  contactName: string | null;
  ownerUserId: number | null;
  ownerName: string | null;
  subject: string;
  details: string | null;
  source: string;
  typeId: number | null;
  typeName: string | null;
  stdHours: number | null;
  statusId: number;
  statusName: string;
  statusClosing: boolean;
  billingStatusId: number | null;
  billingStatusName: string | null;
  durationId: number | null;
  durationName: string | null;
  durationMinutes: number | null;
  openAt: string;
  updatedAt: string | null;
  closedAt: string | null;
  hoursTotal: number;
  /** passed markDelayMinutes while still open */
  delayed: boolean;
  /** went over the call type's std_hours */
  overStd: boolean;
  linked: boolean;
}

export interface CallList {
  rows: CallListRow[];
  total: number;
  page: number;
  pageSize: number;
  openOnly: boolean;
}

export interface Call extends CallListRow {
  companyName: string;
  clientPhone: string | null;
  clientCity: string | null;
  /** the client's remarks for this company — the red banner on every call of this client */
  clientRemarks: string | null;
  hourCost: number | null;
  contactMobile: string | null;
  contactEmail: string | null;
  openBy: number | null;
  openByName: string | null;
  closedByName: string | null;
  eventsCount: number;
  filesCount: number;
  signaturesCount: number;
  params: CallParams;
}

export interface CallEvent {
  id: number;
  body: string | null;
  kind: 'note' | 'system' | 'email' | 'whatsapp';
  createdAt: string;
  createdBy: number | null;
  createdByName: string | null;
  emailedTo: string | null;
  waMessageId: string | null;
}

export interface CallHour {
  id: number;
  companyId: number;
  companyName: string;
  workDate: string;
  fromTime: string | null;
  toTime: string | null;
  hours: number;
  hourPrice: number;
  description: string;
  /** created from the duration field; edited there, not here */
  auto: boolean;
  hourTypeId: number | null;
  hourTypeName: string | null;
  countsInBank: boolean | null;
  hoursBankId: number | null;
  hoursBankName: string | null;
  reporterId: number | null;
  reporterName: string | null;
  createdAt: string;
  total: number;
}

export interface HoursBank {
  id: number;
  name: string;
  hours: number;
  used: number;
  balance: number;
}

export interface CallFile {
  id: number;
  description: string | null;
  fileName: string | null;
  mime: string | null;
  size: number | null;
  uploadedBy: number | null;
  uploadedByName: string | null;
  createdAt: string;
  active: boolean;
}

export interface CallSignature {
  id: number;
  description: string | null;
  signerName: string;
  remarks: string | null;
  signedAt: string;
}

export type LinkKind = 'child' | 'shared' | 'transfer';

export interface CallLink {
  id: number;
  kind: LinkKind;
  reason: string | null;
  relayAllowed: boolean;
  createdAt: string;
  acceptedAt: string | null;
  createdByName: string | null;
  acceptedByName: string | null;
  parentCallId: number;
  parentNumber: number;
  parentSubject: string;
  parentCompanyId: number;
  parentCompanyName: string;
  childCallId: number | null;
  childNumber: number | null;
  toCompanyId: number;
  toCompanyName: string;
  outgoing: boolean;
  pendingRelays: number;
}

export interface CallOrigin {
  linkId: number;
  kind: LinkKind;
  reason: string | null;
  relayAllowed: boolean;
  acceptedAt: string | null;
  parentCallId: number;
  parentNumber: number;
  parentSubject: string;
  fromCompanyId: number;
  fromCompanyName: string;
  parentEvents: CallEvent[];
}

export interface RelayRequest {
  id: number;
  body: string;
  channel: 'email' | 'whatsapp';
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  requestedByName: string | null;
  fromCompanyName: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
}

export interface TransferTarget extends CompanyRef {
  params: CallParams;
  lookups: Lookup[];
  agents: Agent[];
}

export interface Note {
  id: number;
  kind: 'card' | 'sticky';
  clientId: number | null;
  clientName: string | null;
  callId: number | null;
  callNumber: number | null;
  callSubject: string | null;
  companyId: number | null;
  body: string;
  authorId: number | null;
  authorName: string | null;
  createdAt: string;
  editedAt: string | null;
  pinnedFor: number | null;
  pinnedForName: string | null;
  dueAt: string | null;
  doneAt: string | null;
  doneBy: number | null;
  doneByName: string | null;
  mentions: number[];
}

// ---------------------------------------------------------------- endpoints

export const callsApi = {
  meta: () => api.get<CallMeta>('/api/calls/meta'),
  list: (query: string) => api.get<CallList>(`/api/calls${query ? `?${query}` : ''}`),
  exportUrl: (query: string) => `/api/calls/export${query ? `?${query}` : ''}`,
  get: (id: number) => api.get<Call>(`/api/calls/${id}`),
  create: (body: unknown) => api.post<{ id: number; number: number }>('/api/calls', body),
  update: (id: number, body: unknown) => api.patch<Call>(`/api/calls/${id}`, body),
  remove: (id: number) => api.del<{ ok: true }>(`/api/calls/${id}?confirm=yes`),

  events: (id: number) => api.get<CallEvent[]>(`/api/calls/${id}/events`),
  addEvent: (id: number, body: string, close = false) =>
    api.post<{ id: number; closed: boolean }>(`/api/calls/${id}/events`, { body, close }),

  hours: (id: number) => api.get<{ rows: CallHour[]; hoursTotal: number }>(`/api/calls/${id}/hours`),
  addHour: (id: number, body: unknown) => api.post<{ id: number }>(`/api/calls/${id}/hours`, body),
  editHour: (id: number, hourId: number, body: unknown) =>
    api.patch<{ ok: true }>(`/api/calls/${id}/hours/${hourId}`, body),
  removeHour: (id: number, hourId: number) => api.del<{ ok: true }>(`/api/calls/${id}/hours/${hourId}`),
  banks: (id: number) => api.get<HoursBank[]>(`/api/calls/${id}/hours-banks`),

  files: (id: number) => api.get<CallFile[]>(`/api/calls/${id}/files`),
  fileUrl: (id: number, fileId: number, inline = false) =>
    `/api/calls/${id}/files/${fileId}${inline ? '?inline=1' : ''}`,
  editFile: (id: number, fileId: number, body: unknown) =>
    api.patch<{ ok: true }>(`/api/calls/${id}/files/${fileId}`, body),
  removeFile: (id: number, fileId: number) => api.del<{ ok: true }>(`/api/calls/${id}/files/${fileId}`),

  signatures: (id: number) =>
    api.get<{ rows: CallSignature[]; defaultText: string }>(`/api/calls/${id}/signatures`),
  signatureUrl: (id: number, signatureId: number) => `/api/calls/${id}/signatures/${signatureId}/image`,
  sign: (id: number, body: unknown) => api.post<{ id: number }>(`/api/calls/${id}/signatures`, body),

  links: (id: number) => api.get<CallLink[]>(`/api/calls/${id}/links`),
  targets: (id: number) => api.get<TransferTarget[]>(`/api/calls/${id}/links/targets`),
  link: (id: number, body: unknown) =>
    api.post<{ id: number; kind: LinkKind; childCallId: number | null; childNumber: number | null }>(
      `/api/calls/${id}/links`,
      body,
    ),
  acceptLink: (id: number, linkId: number) =>
    api.post<{ ok: true }>(`/api/calls/${id}/links/${linkId}/accept`, {}),
  origin: (id: number) => api.get<CallOrigin | null>(`/api/calls/${id}/origin`),
  relayRequests: (id: number) => api.get<RelayRequest[]>(`/api/calls/${id}/relay-requests`),
  requestRelay: (id: number, body: unknown) =>
    api.post<{ id: number; status: string }>(`/api/calls/${id}/relay-requests`, body),
  pendingRelays: () => api.get<Record<string, unknown>[]>('/api/relay-requests/pending'),
  approveRelay: (requestId: number, note?: string) =>
    api.post<{ ok: true; queued: boolean; blocked: boolean }>(`/api/relay-requests/${requestId}/approve`, { note }),
  rejectRelay: (requestId: number, note?: string) =>
    api.post<{ ok: true }>(`/api/relay-requests/${requestId}/reject`, { note }),

  notes: (query: string) => api.get<Note[]>(`/api/notes?${query}`),
  myStickies: () => api.get<Note[]>('/api/notes/sticky/mine'),
  addNote: (body: unknown) => api.post<{ id: number }>('/api/notes', body),
  editNote: (id: number, body: unknown) => api.patch<{ ok: true }>(`/api/notes/${id}`, body),
  noteDone: (id: number, done: boolean) => api.post<{ ok: true; done: boolean }>(`/api/notes/${id}/done`, { done }),
  removeNote: (id: number) => api.del<{ ok: true }>(`/api/notes/${id}`),
};

// ---------------------------------------------------------------- formatting

const pad = (n: number) => (n < 10 ? '0' : '') + n;

/** Dates are shown as the office reads them: d/m/y, and the time only when asked. */
export function dateText(value: string | null | undefined, withTime = false): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

export const hoursText = (value: number | null | undefined): string =>
  value == null ? '' : (Math.round(Number(value) * 100) / 100).toFixed(2);

/** "+972…" and plain numbers stay left-to-right inside Hebrew text. */
export const ltr = (value: string) => `⁦${value}⁩`;

export const byKind = (lookups: Lookup[], kind: LookupKind): Lookup[] =>
  lookups.filter((l) => l.kind === kind).sort((a, b) => a.sort - b.sort || a.id - b.id);

/**
 * The five call-status colours. They are deliberately NOT derived from the company
 * brand: an agent who works for two companies must see the same status in the same
 * colour. The tokens live in calls.css (see the note at the top of that file).
 */
export type StatusTone = 'open' | 'progress' | 'waiting' | 'closed' | 'overdue';

const WAITING = /ממתין|למעקב|awaiting|follow/i;
const PROGRESS = /בטיפול|progress/i;

/**
 * Which of the five tones a status gets. A closing status is always "closed";
 * everything else is read from the status name, which is why new statuses added
 * by an admin still land on a sensible colour instead of none.
 */
export function statusTone(row: Pick<CallListRow, 'statusName' | 'statusClosing'>): StatusTone {
  if (row.statusClosing) return 'closed';
  if (WAITING.test(row.statusName)) return 'waiting';
  if (PROGRESS.test(row.statusName)) return 'progress';
  return 'open';
}

/** The overdue tone wins over the status tone in the list, so a late call stands out. */
export const rowTone = (row: CallListRow): StatusTone =>
  row.delayed || row.overStd ? 'overdue' : statusTone(row);

export const overdueTitle = (row: CallListRow): string =>
  [
    row.delayed ? t('הקריאה פתוחה מעל זמן הסימון', 'Open past the flagging time') : '',
    row.overStd ? t('חריגה מתקן השעות של סוג הקריאה', 'Over the call type standard hours') : '',
  ]
    .filter(Boolean)
    .join(' · ');
