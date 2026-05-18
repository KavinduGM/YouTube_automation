// Filename helpers. Channels are dynamic — the watcher looks up
// channel.filenamePrefix at runtime, so we don't hardcode prefixes here.
//
// RAW upload patterns (admin → Drive):
//   Long question:   {PREFIX}_{TAG}_Question[s].{ext}
//   Long animation:  {PREFIX}_{TAG}_Animation[s].{ext}
//   Short (N-th):    {PREFIX}_{TAG}_Short_{N}.{ext}
//   Thumbnail:       <same base>_thumb.{jpg|png}
//
// FINAL filename pattern (system-computed, also matches editor's upload):
//   {PREFIX}_{YYYY-MM-DD}_{TYPE}_{SLOT}_{TAG}[_{FORMAT}].{ext}
//   e.g. ABT_2026-05-22_long_1_D300_question.mp4
//        ABT_2026-05-22_short_1_D300.mp4

export type ContentTypeSlug = 'long' | 'short' | 'post';
export type VideoFormatSlug = 'question' | 'animation';

export interface ParsedFinalFilename {
  prefix: string;
  datePart: string; // YYYY-MM-DD
  type: ContentTypeSlug;
  slot: string;
  tag?: string;
  format?: VideoFormatSlug;
  ext: string;
  baseName: string;
}

// Final filename: {PREFIX}_{YYYY-MM-DD}_{TYPE}_{SLOT}[_{TAG}][_{FORMAT}].{ext}
// Old format also accepted: {PREFIX}_{YYYY-MM-Wn}_{TYPE}_{SLOT}[_{TAG}].{ext}
const FINAL_RE = /^([A-Z][A-Z0-9]+)_([0-9]{4}-[0-9]{2}(?:-[0-9]{2}|-W[0-9]{1,2}))_([a-z]+)_([A-Za-z0-9]+)(?:_([A-Za-z0-9-]+))?(?:_(question|animation))?\.([A-Za-z0-9]+)$/i;

export function parseFinalFilename(filename: string): ParsedFinalFilename | null {
  const m = FINAL_RE.exec(filename);
  if (!m) return null;
  const [, prefix, datePart, type, slot, tag, format, ext] = m;
  if (!prefix || !datePart || !type || !slot || !ext) return null;
  return {
    prefix,
    datePart,
    type: type.toLowerCase() as ContentTypeSlug,
    slot,
    tag: tag || undefined,
    format: (format?.toLowerCase() as VideoFormatSlug) || undefined,
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

// ─────── Raw filename patterns ───────

export interface ParsedRawFilename {
  prefix: string;
  tag: string;
  // For long: 'question' | 'animation' (from the suffix word).
  // For short: undefined, and `shortNumber` is set instead.
  format?: VideoFormatSlug;
  type: 'long' | 'short';
  shortNumber?: number;
  ext: string;
  baseName: string;
}

// Long with format suffix: {PREFIX}_{TAG}_Question[s]|Animation[s].{ext}
const RAW_LONG_RE = /^([A-Z][A-Z0-9]+)_([A-Za-z0-9-]+)_(question|questions|animation|animations)\.([A-Za-z0-9]+)$/i;

// Short numbered: {PREFIX}_{TAG}_Short_{N}.{ext}
const RAW_SHORT_RE = /^([A-Z][A-Z0-9]+)_([A-Za-z0-9-]+)_short_(\d+)\.([A-Za-z0-9]+)$/i;

export function parseRawFilename(filename: string): ParsedRawFilename | null {
  // Exclude finals — position 2 starts with a year
  if (/^[A-Z][A-Z0-9]+_\d{4}-/.test(filename)) return null;

  const lm = RAW_LONG_RE.exec(filename);
  if (lm) {
    const [, prefix, tag, fmt, ext] = lm;
    if (!prefix || !tag || !fmt || !ext) return null;
    const format = (fmt.toLowerCase().startsWith('q') ? 'question' : 'animation') as VideoFormatSlug;
    return {
      prefix,
      tag,
      type: 'long',
      format,
      ext: ext.toLowerCase(),
      baseName: filename.replace(/\.[A-Za-z0-9]+$/, ''),
    };
  }
  const sm = RAW_SHORT_RE.exec(filename);
  if (sm) {
    const [, prefix, tag, num, ext] = sm;
    if (!prefix || !tag || !num || !ext) return null;
    return {
      prefix,
      tag,
      type: 'short',
      shortNumber: Number(num),
      ext: ext.toLowerCase(),
      baseName: filename.replace(/\.[A-Za-z0-9]+$/, ''),
    };
  }
  return null;
}

// Doc files alongside a raw video share the base name + extension change.
// Accepted suffixes: _theory, _question (as theory companion), _notes.
// E.g. OAP_D440_theory.txt
export interface ParsedRawDoc {
  prefix: string;
  tag: string;
  kind: 'theory' | 'question' | 'other';
  ext: string;
  filename: string;
}

const RAW_DOC_RE = /^([A-Z][A-Z0-9]+)_([A-Za-z0-9-]+)_([A-Za-z]+)\.([A-Za-z0-9]+)$/;
const DOC_EXTS = new Set(['txt', 'pdf', 'docx', 'doc', 'md', 'rtf']);

export function parseRawDoc(filename: string): ParsedRawDoc | null {
  if (/^[A-Z][A-Z0-9]+_\d{4}-/.test(filename)) return null;
  const m = RAW_DOC_RE.exec(filename);
  if (!m) return null;
  const [, prefix, tag, suffix, ext] = m;
  if (!prefix || !tag || !suffix || !ext) return null;
  if (!DOC_EXTS.has(ext.toLowerCase())) return null;
  // Don't treat raw-format suffixes as docs
  if (/^(short|question|questions|animation|animations)$/i.test(suffix)) return null;
  let kind: ParsedRawDoc['kind'] = 'other';
  if (/^theor/i.test(suffix)) kind = 'theory';
  else if (/^quest/i.test(suffix)) kind = 'question';
  else if (/^notes$/i.test(suffix)) kind = 'other';
  return {
    prefix,
    tag,
    kind,
    ext: ext.toLowerCase(),
    filename,
  };
}

// ─────── Final filename builder ───────

// All scheduled videos (long and short) get a YYYY-MM-DD datePart.
export function datePartFor(opts: { scheduledAt: Date }): string {
  const d = opts.scheduledAt;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function computeExpectedFilename(opts: {
  prefix: string;
  type: ContentTypeSlug;
  scheduledAt: Date;
  slot: number;
  tag?: string;
  format?: VideoFormatSlug;
  ext?: string;
}): string {
  const datePart = datePartFor({ scheduledAt: opts.scheduledAt });
  const tag = opts.tag ? `_${opts.tag}` : '';
  const format = opts.format ? `_${opts.format}` : '';
  const ext = opts.ext ?? 'mp4';
  return `${opts.prefix}_${datePart}_${opts.type}_${opts.slot}${tag}${format}.${ext}`;
}

// Suggest a default filenamePrefix from a channel name or slug.
// "AB Test" → "ABTEST"; "ab-test" → "ABTEST"; "Online Allied Prep" → "OAP" (first letters of each word capped to 6).
export function suggestFilenamePrefix(name: string): string {
  const words = name.trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 6) {
    return words.map((w) => w[0]!.toUpperCase()).join('').slice(0, 6);
  }
  return name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'CHN';
}
