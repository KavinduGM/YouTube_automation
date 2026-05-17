import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { clientForDriveSheets } from './auth.js';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number; // bytes
  modifiedTime: string;
  parents: string[];
}

function driveClient(auth: OAuth2Client) {
  return google.drive({ version: 'v3', auth });
}

// List children of a folder (non-recursive). Optionally filter by modifiedTime > since.
export async function listFolderChildren(folderId: string, opts?: { since?: Date }): Promise<DriveFile[]> {
  const auth = await clientForDriveSheets();
  const drive = driveClient(auth);
  const all: DriveFile[] = [];

  let qParts = [`'${folderId}' in parents`, 'trashed = false'];
  if (opts?.since) qParts.push(`modifiedTime > '${opts.since.toISOString()}'`);
  const q = qParts.join(' and ');

  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id,name,mimeType,size,modifiedTime,parents)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) {
      all.push({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType ?? '',
        size: Number(f.size ?? 0),
        modifiedTime: f.modifiedTime ?? '',
        parents: f.parents ?? [],
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return all;
}

// Recursively walk a folder. Returns all (non-folder) files.
export async function walkFolder(rootFolderId: string): Promise<DriveFile[]> {
  const auth = await clientForDriveSheets();
  const drive = driveClient(auth);

  const stack = [rootFolderId];
  const out: DriveFile[] = [];
  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  while (stack.length) {
    const folderId = stack.pop()!;
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id,name,mimeType,size,modifiedTime,parents)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of res.data.files ?? []) {
        if (f.mimeType === FOLDER_MIME) {
          stack.push(f.id!);
        } else {
          out.push({
            id: f.id!,
            name: f.name!,
            mimeType: f.mimeType ?? '',
            size: Number(f.size ?? 0),
            modifiedTime: f.modifiedTime ?? '',
            parents: f.parents ?? [],
          });
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return out;
}

// Download a Drive file to a local path. Streams to disk.
export async function downloadFile(fileId: string, destPath: string): Promise<void> {
  const auth = await clientForDriveSheets();
  const drive = driveClient(auth);
  await mkdir(dirname(destPath), { recursive: true });
  const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destPath);
    res.data.on('error', reject);
    out.on('error', reject);
    out.on('finish', () => resolve());
    res.data.pipe(out);
  });
  const s = await stat(destPath);
  if (s.size === 0) {
    await unlink(destPath).catch(() => {});
    throw new Error(`Downloaded file ${fileId} is empty`);
  }
}

// Move a file into a different folder. Idempotent — returns moved:false if
// the file is already only in the target folder.
export async function moveFile(
  fileId: string,
  toFolderId: string,
): Promise<{ moved: boolean }> {
  const auth = await clientForDriveSheets();
  const drive = driveClient(auth);
  const meta = await drive.files.get({
    fileId,
    fields: 'parents',
    supportsAllDrives: true,
  });
  const currentParents = meta.data.parents ?? [];
  if (currentParents.length === 1 && currentParents[0] === toFolderId) {
    return { moved: false };
  }
  const removeParents = currentParents.join(',');
  await drive.files.update({
    fileId,
    addParents: toFolderId,
    removeParents,
    supportsAllDrives: true,
    fields: 'id,parents',
  });
  return { moved: true };
}

export async function getFileMeta(fileId: string): Promise<DriveFile | null> {
  const auth = await clientForDriveSheets();
  const drive = driveClient(auth);
  const res = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,size,modifiedTime,parents',
    supportsAllDrives: true,
  });
  const f = res.data;
  if (!f.id) return null;
  return {
    id: f.id,
    name: f.name ?? '',
    mimeType: f.mimeType ?? '',
    size: Number(f.size ?? 0),
    modifiedTime: f.modifiedTime ?? '',
    parents: f.parents ?? [],
  };
}

// Probe a Drive video file's duration. Drive only has videoMediaMetadata
// after it has fully processed the upload (can take a minute for large
// files). Returns null if not yet available.
export async function getVideoDurationMs(fileId: string): Promise<number | null> {
  const auth = await clientForDriveSheets();
  const drive = driveClient(auth);
  const res = await drive.files.get({
    fileId,
    fields: 'id,videoMediaMetadata(durationMillis)',
    supportsAllDrives: true,
  });
  const ms = res.data.videoMediaMetadata?.durationMillis;
  if (!ms) return null;
  const n = Number(ms);
  return Number.isFinite(n) ? n : null;
}

// Stream-upload a file to Drive (multipart resumable). Used by the editor
// dashboard to push the edited video/thumbnail into the channel folder.
export async function uploadStream(opts: {
  parentFolderId: string;
  filename: string;
  mimeType: string;
  body: NodeJS.ReadableStream;
}): Promise<{ id: string }> {
  const auth = await clientForDriveSheets();
  const drive = driveClient(auth);
  const res = await drive.files.create({
    requestBody: {
      name: opts.filename,
      parents: [opts.parentFolderId],
    },
    media: {
      mimeType: opts.mimeType,
      body: opts.body,
    },
    supportsAllDrives: true,
    fields: 'id',
  });
  if (!res.data.id) throw new Error('Drive upload returned no id');
  return { id: res.data.id };
}

// Get a streamable read of a Drive file (for proxying downloads to the editor).
export async function getFileStream(fileId: string): Promise<{
  stream: NodeJS.ReadableStream;
  mimeType: string;
  name: string;
  size: number;
}> {
  const auth = await clientForDriveSheets();
  const drive = driveClient(auth);
  const meta = await drive.files.get({
    fileId,
    fields: 'name,mimeType,size',
    supportsAllDrives: true,
  });
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  );
  return {
    stream: res.data,
    mimeType: meta.data.mimeType ?? 'application/octet-stream',
    name: meta.data.name ?? `file-${fileId}`,
    size: Number(meta.data.size ?? 0),
  };
}
