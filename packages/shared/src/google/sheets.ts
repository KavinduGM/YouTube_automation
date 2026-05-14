import { google } from 'googleapis';
import { clientForDriveSheets } from './auth.js';

// Write status updates to a row in the team's monthly content sheet.
// Layout assumption (configurable per channel later): the row has these named columns
// somewhere in the first sheet/tab. We find them by header text on row 1.
//
// Recognised header names (case-insensitive):
//   "status", "youtube url", "youtube_id", "published_at", "scheduled_at", "approved_by", "filename"
//
// If the headers don't exist, the cells are simply not updated.

export interface SheetStatusUpdate {
  spreadsheetId: string;
  tab?: string;          // sheet/tab name; defaults to first tab
  matchByFilename: string; // expected filename in a 'filename' column
  status?: string;
  youtubeUrl?: string;
  youtubeId?: string;
  publishedAt?: string;
  scheduledAt?: string;
  approvedBy?: string;
}

export async function writeStatusToSheet(u: SheetStatusUpdate): Promise<{ updated: boolean; row?: number }> {
  const auth = await clientForDriveSheets();
  const sheets = google.sheets({ version: 'v4', auth });

  // Resolve tab name
  let tabName = u.tab;
  if (!tabName) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: u.spreadsheetId });
    tabName = meta.data.sheets?.[0]?.properties?.title ?? 'Sheet1';
  }

  // Read full tab so we can find headers + the right row
  const range = `${tabName}!A1:Z10000`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: u.spreadsheetId, range });
  const rows = res.data.values ?? [];
  if (rows.length === 0) return { updated: false };

  const headers = (rows[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase());

  function colIndex(name: string): number {
    return headers.indexOf(name);
  }

  const filenameCol = colIndex('filename');
  if (filenameCol < 0) return { updated: false };

  // Find row whose filename column matches (case-insensitive, ignoring extension)
  const target = u.matchByFilename.toLowerCase().replace(/\.[^.]+$/, '');
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const cell = String((rows[i] ?? [])[filenameCol] ?? '').toLowerCase().replace(/\.[^.]+$/, '');
    if (cell === target) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) return { updated: false };

  const updates: { col: number; value: string }[] = [];
  function add(name: string, value: string | undefined) {
    if (value === undefined) return;
    const idx = colIndex(name);
    if (idx >= 0) updates.push({ col: idx, value });
  }
  add('status', u.status);
  add('youtube url', u.youtubeUrl);
  add('youtube_id', u.youtubeId);
  add('published_at', u.publishedAt);
  add('scheduled_at', u.scheduledAt);
  add('approved_by', u.approvedBy);

  if (updates.length === 0) return { updated: false, row: rowIndex + 1 };

  const data = updates.map(({ col, value }) => ({
    range: `${tabName}!${columnLetter(col)}${rowIndex + 1}`,
    values: [[value]],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: u.spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data,
    },
  });
  return { updated: true, row: rowIndex + 1 };
}

function columnLetter(idx: number): string {
  // 0 -> A, 25 -> Z, 26 -> AA
  let n = idx;
  let s = '';
  while (true) {
    const r = n % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) return s;
  }
}
