import { google } from 'googleapis';
import { clientForDriveSheets } from './auth.js';

// Write status updates to a row in the team's monthly content sheet.
// Row 1 must be a header row. Recognised columns (case-insensitive):
//   filename (REQUIRED — used to match)
//   status, youtube url, youtube_id, published_at, scheduled_at, approved_by
//
// If a row with the matching filename doesn't exist yet, we APPEND a new
// row at the bottom and fill it in (so the sheet becomes a self-populating
// log — operator just provides headers).

export interface SheetStatusUpdate {
  spreadsheetId: string;
  tab?: string;            // sheet/tab name; defaults to first tab
  matchByFilename: string; // expected filename in a 'filename' column
  status?: string;
  youtubeUrl?: string;
  youtubeId?: string;
  publishedAt?: string;
  scheduledAt?: string;
  approvedBy?: string;
}

export async function writeStatusToSheet(
  u: SheetStatusUpdate,
): Promise<{ updated: boolean; row?: number; appended?: boolean }> {
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
    const cell = String((rows[i] ?? [])[filenameCol] ?? '')
      .toLowerCase()
      .replace(/\.[^.]+$/, '');
    if (cell === target) {
      rowIndex = i;
      break;
    }
  }

  // Build the value map by header name
  const fieldByHeader: Record<string, string | undefined> = {
    'filename': u.matchByFilename,
    'status': u.status,
    'youtube url': u.youtubeUrl,
    'youtube_id': u.youtubeId,
    'published_at': u.publishedAt,
    'scheduled_at': u.scheduledAt,
    'approved_by': u.approvedBy,
  };

  if (rowIndex < 0) {
    // No matching row → append a new row with the values aligned to the headers.
    const newRow: (string | null)[] = new Array(headers.length).fill('');
    for (const [headerName, value] of Object.entries(fieldByHeader)) {
      if (value === undefined) continue;
      const idx = colIndex(headerName);
      if (idx >= 0) newRow[idx] = value;
    }
    const appendRes = await sheets.spreadsheets.values.append({
      spreadsheetId: u.spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] },
    });
    // Parse the appended row index out of the updatedRange (e.g. "Tab!A12:G12")
    const appendedRange = appendRes.data.updates?.updatedRange ?? '';
    const m = /![A-Z]+(\d+):/.exec(appendedRange);
    const appendedRow = m ? Number(m[1]) : undefined;
    return { updated: true, appended: true, row: appendedRow };
  }

  // Found existing row → just patch the recognised cells.
  const updates: { col: number; value: string }[] = [];
  for (const [headerName, value] of Object.entries(fieldByHeader)) {
    if (headerName === 'filename') continue; // don't overwrite the match key
    if (value === undefined) continue;
    const idx = colIndex(headerName);
    if (idx >= 0) updates.push({ col: idx, value });
  }

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
