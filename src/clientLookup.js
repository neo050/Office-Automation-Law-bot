import { drive, sheets } from './gAuth.js';
import { log } from './logger.js';
import { folderExists } from './driveUtils.js';

const SPREADSHEET_ID = process.env.SHEETS_ID;
const SHEET_NAME     = process.env.SHEET_NAME || 'Clients';

// Columns: A:ID | B:FullName | C:Phone | D:DriveFolderId
const RANGE_READ   = `'${SHEET_NAME}'!A1:D`;
const RANGE_ALL    = `'${SHEET_NAME}'!A:D`;
const COL_D_RANGE  = r => `'${SHEET_NAME}'!D${r}`;
const ROW_RANGE    = r => `'${SHEET_NAME}'!A${r}:D${r}`;

/**
 * Create/Update client row. Verify Drive folder exists if stored.
 * @returns { rowNumber, driveFolderId|null, exists:boolean, row:Array }
 */
export async function upsertClientRow({ id, fullName = '', phone = '' }) {
  log.step('clientLookup.upsertClientRow', 'start', { id, fullName, phone });
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE_READ });
  const rows = data.values ?? [];

  const idx = rows.findIndex(r => r[0] === id);
  if (idx !== -1) {
    const rowNumber = idx + 1;
    let [ , nameCell = '', phoneCell = '', folderCell = '' ] = rows[idx];
    let folderId = folderCell || null;

    if (folderId && !(await folderExists(folderId))) {
      log.info('clientLookup', 'folderId invalid. clearing in sheet', { folderId });
      folderId = null;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: COL_D_RANGE(rowNumber),
        valueInputOption: 'RAW',
        requestBody: { values: [['']] }
      });
    }

    // fill missing fields if provided now
    if ((fullName && !nameCell) || (phone && !phoneCell)) {
      nameCell  = nameCell  || fullName;
      phoneCell = phoneCell || phone;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: ROW_RANGE(rowNumber),
        valueInputOption: 'RAW',
        requestBody: { values: [[id, nameCell, phoneCell, folderId || '']] }
      });
    }

    return { rowNumber, driveFolderId: folderId, exists: true, row: [id, nameCell, phoneCell, folderId] };
  }

  // new row
  const append = await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE_ALL,
    valueInputOption: 'RAW',
    requestBody: { values: [[id, fullName, phone, '']] }
  });
  const rowNumber = Number(append.data.updates.updatedRange.match(/\d+$/)[0]);
  log.step('clientLookup.upsertClientRow', 'created', { rowNumber });
  return { rowNumber, driveFolderId: null, exists: false, row: [id, fullName, phone, null] };
}

export async function updateDriveFolderId(rowNumber, folderId) {
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: COL_D_RANGE(rowNumber),
      valueInputOption: 'RAW',
      requestBody: { values: [[folderId]] }
    });
  } catch (err) {
    log.error('clientLookup.updateDriveFolderId', 'failed', err.response?.data || err);
    throw new Error('sheets_update_failed');
  }
}