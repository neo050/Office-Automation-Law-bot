import { log } from './logger.js';
import { drive, sheets } from './gAuth.js';



 const driveOpts = (process.env.DRIVE_MODE === 'shared')
  ? { supportsAllDrives: true, driveId: process.env.DRIVE_ROOT_ID, includeItemsFromAllDrives: true }
  : {};

/** Check if folder exists physically in Drive. */
export async function folderExists(id) {
  try {
     const { data } = await drive.files.get({ fileId: id, fields: 'id', ...driveOpts });
     return Boolean(data?.id);
  } catch (e) {
    if (e.code === 404) return false;
    log.error('driveUtils.folderExists', 'unknown error', e);
    return false;
  }
}

/** Ensure folder named `name` under `parentId`. */
export async function ensureFolder(name, parentId) {
  const q = [
    "mimeType = 'application/vnd.google-apps.folder'",
    `name = '${name.replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    'trashed = false'
  ].join(' and ');

  const { data } = await drive.files.list({ q, fields: 'files(id,name)', pageSize: 10, ...driveOpts });
  if (data.files?.length) return data.files[0];

  const { data: created } = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id,name',
    ...driveOpts
  });
  return created;
}
export { driveOpts };