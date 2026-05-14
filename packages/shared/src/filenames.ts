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
