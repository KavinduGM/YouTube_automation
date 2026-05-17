// Filename convention:
//   {CHANNEL}_{YYYY-MM-DD or YYYY-MM-Wn}_{TYPE}_{SLOT}[_{TAG}].{ext}
// Examples:
//   OAP_2026-05-16_short_1.mp4
//   OAG_2026-05-W3_long_D330.mp4
//   NUR_2026-05-16_short_2.mp4
//
// CHANNEL: OAP | OAG | NUR
// TYPE:    long | short | post
// SLOT:    integer (per-day index) — for long videos with weekly identifier, use exam tag at the end
// TAG:     optional — exam code for long videos (e.g. D330)

export type ChannelSlug = 'OAP' | 'OAG' | 'NUR';
export type ContentTypeSlug = 'long' | 'short' | 'post';

export interface ParsedFilename {
  channel: ChannelSlug;
  datePart: string; // raw date or week token (e.g. 2026-05-16 or 2026-05-W3)
  type: ContentTypeSlug;
  slot: string; // numeric or non-numeric (e.g. D330 for long)
  tag?: string;
  ext: string; // without dot
  baseName: string; // filename without extension
}

const CHANNELS: ReadonlySet<ChannelSlug> = new Set(['OAP', 'OAG', 'NUR']);
const TYPES: ReadonlySet<ContentTypeSlug> = new Set(['long', 'short', 'post']);

const FILENAME_RE = /^([A-Z]{2,4})_([0-9]{4}-[0-9]{2}(?:-[0-9]{2}|-W[0-9]{1,2}))_([a-z]+)_([A-Za-z0-9]+)(?:_([A-Za-z0-9]+))?\.([A-Za-z0-9]+)$/;

export function parseFilename(filename: string): ParsedFilename | null {
  const m = FILENAME_RE.exec(filename);
  if (!m) return null;
  const [, channel, datePart, type, slot, tag, ext] = m;
  if (!channel || !datePart || !type || !slot || !ext) return null;
  if (!CHANNELS.has(channel as ChannelSlug)) return null;
  if (!TYPES.has(type as ContentTypeSlug)) return null;
  return {
    channel: channel as ChannelSlug,
    datePart,
    type: type as ContentTypeSlug,
    slot,
    tag,
    ext: ext.toLowerCase(),
    baseName: filename.replace(/\.[A-Za-z0-9]+$/, ''),
  };
}

export const VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'webm']);
export const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png']);

export function isVideo(ext: string): boolean {
  return VIDEO_EXTS.has(ext.toLowerCase());
}
export function isImage(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

// Compute the canonical "expected filename" base (without extension) for a content item.
export function expectedBaseName(opts: {
  channel: ChannelSlug;
  datePart: string;
  type: ContentTypeSlug;
  slot: string;
  tag?: string;
}): string {
  const tag = opts.tag ? `_${opts.tag}` : '';
  return `${opts.channel}_${opts.datePart}_${opts.type}_${opts.slot}${tag}`;
}

// ─────── Raw filename pattern ───────
// Raw uploads from admin use the simpler pattern:
//   {CHANNEL}_{TAG}.{ext}
// Where TAG starts with a letter (distinguishes from finals whose second
// position is a year, e.g. "2026-05-16").
// Examples:
//   OAP_D440.mp4
//   NUR_NCLEX-cardio.mp4
//   OAG_D330.mov
//
// Doc files alongside follow the same prefix:
//   OAP_D440_theory.txt
//   OAP_D440_question.pdf

export interface ParsedRawFilename {
  channel: ChannelSlug;
  tag: string;
  ext: string;
  baseName: string; // e.g. "OAP_D440"
}

const RAW_RE = /^([A-Z]{2,4})_([A-Za-z][A-Za-z0-9-]*)\.([A-Za-z0-9]+)$/;

export function parseRawFilename(filename: string): ParsedRawFilename | null {
  // Don't match if this is a final (position 2 starts with a digit = year)
  if (/^[A-Z]{2,4}_\d/.test(filename)) return null;
  const m = RAW_RE.exec(filename);
  if (!m) return null;
  const [, channel, tag, ext] = m;
  if (!channel || !tag || !ext) return null;
  if (!CHANNELS.has(channel as ChannelSlug)) return null;
  return {
    channel: channel as ChannelSlug,
    tag,
    ext: ext.toLowerCase(),
    baseName: `${channel}_${tag}`,
  };
}

// Detect doc files attached to a raw upload: e.g. OAP_D440_theory.txt
// Returns the kind hint ("theory" | "question" | "other") and channel/tag.
export interface ParsedRawDoc {
  channel: ChannelSlug;
  tag: string;       // matches the raw's tag
  kind: 'theory' | 'question' | 'other';
  ext: string;
  filename: string;
}

const RAW_DOC_RE = /^([A-Z]{2,4})_([A-Za-z][A-Za-z0-9-]*)_([A-Za-z]+)\.([A-Za-z0-9]+)$/;
const DOC_EXTS = new Set(['txt', 'pdf', 'docx', 'doc', 'md', 'rtf']);

export function parseRawDoc(filename: string): ParsedRawDoc | null {
  if (/^[A-Z]{2,4}_\d/.test(filename)) return null; // exclude finals
  const m = RAW_DOC_RE.exec(filename);
  if (!m) return null;
  const [, channel, tag, suffix, ext] = m;
  if (!channel || !tag || !suffix || !ext) return null;
  if (!CHANNELS.has(channel as ChannelSlug)) return null;
  if (!DOC_EXTS.has(ext.toLowerCase())) return null;
  let kind: ParsedRawDoc['kind'] = 'other';
  if (/^theor/i.test(suffix)) kind = 'theory';
  else if (/^quest/i.test(suffix)) kind = 'question';
  return {
    channel: channel as ChannelSlug,
    tag,
    kind,
    ext: ext.toLowerCase(),
    filename,
  };
}

// ─────── Final filename builder from a publish slot ───────
// Given a slot's scheduledAt + channel + type, produce the "datePart"
// portion of the final filename. We use YYYY-MM-DD for daily content
// (shorts) and YYYY-MM-Wn for weekly content (long videos).
export function datePartFor(opts: { scheduledAt: Date; type: ContentTypeSlug }): string {
  const d = opts.scheduledAt;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  if (opts.type === 'long') {
    // Week-of-month (1..5) where week 1 contains the 1st of the month.
    const dayOfMonth = d.getUTCDate();
    const week = Math.floor((dayOfMonth - 1) / 7) + 1;
    return `${y}-${m}-W${week}`;
  }
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Compute slot number for a date+channel+type by counting how many slots
// of the same channel+type+date(/week) come before this one.
// Pass in the position (1..N) returned from a DB query.
export function computeExpectedFilename(opts: {
  channel: ChannelSlug;
  type: ContentTypeSlug;
  scheduledAt: Date;
  slot: number;          // 1-indexed slot within the day/week
  tag?: string;          // exam tag e.g. "D440"
  ext?: string;          // defaults to "mp4"
}): string {
  const datePart = datePartFor({ scheduledAt: opts.scheduledAt, type: opts.type });
  const tag = opts.tag ? `_${opts.tag}` : '';
  const ext = opts.ext ?? 'mp4';
  return `${opts.channel}_${datePart}_${opts.type}_${opts.slot}${tag}.${ext}`;
}
