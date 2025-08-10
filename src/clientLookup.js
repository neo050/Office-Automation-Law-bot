// ────────────────────────────────────────────────────────────────
//  src/clientLookup.js   ·   production build  (v2025-08-08)
//  change-log:
//    • NEW  findClientByPhone()  – bootstrap by WhatsApp number
//    • MERGE duplicated helpers
//    • STRONGER trace-logging on every external call / branch
// ────────────────────────────────────────────────────────────────

import { sheets }       from './gAuth.js';
import { log }          from './logger.js';
import { folderExists } from './driveUtils.js';

/* ⇢⇢  CONSTANTS  ────────────────────────────────────────────── */
const SPREADSHEET_ID = process.env.SHEETS_ID;
const SHEET_NAME     = process.env.SHEET_NAME || 'Clients';
const RANGE_READ     = `'${SHEET_NAME}'!A1:Z`;   // header + data
const RANGE_ALL      = `'${SHEET_NAME}'!A:Z`;

/* ⇢⇢  SMALL HELPERS  ────────────────────────────────────────── */
function idxByHeader(headerRow, header) {
  const i = headerRow.indexOf(header);
  if (i === -1) log.error('clientLookup', `header_missing_${header}`, headerRow);
  return i;
}
function emptyResult(reason) {
  return { error: reason, rowNumber:null, driveFolderId:null, exists:false, row:[] };
}

/* =====================================================================
   0.  findClientByPhone  (read-only bootstrap)
   ===================================================================== */
export async function findClientByPhone(phone) {
  log.step('findClientByPhone', 'START', { phone });

  try {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE_READ
    });
    const rows = data.values ?? [];
    if (!rows.length) return { ok:false, found:false };

    const IDX_PHONE = idxByHeader(rows[0], 'Phone');
    const IDX_NAME  = idxByHeader(rows[0], 'FullName');
    if (IDX_PHONE === -1) return { ok:false, found:false };

    for (const row of rows.slice(1)) {
      if ((row[IDX_PHONE] || '').trim() === phone) {
        log.step('findClientByPhone', 'FOUND', { phone, fullName: row[IDX_NAME] });
        return { ok:true, found:true, fullName: row[IDX_NAME] || null };
      }
    }
    log.step('findClientByPhone', 'NOT_FOUND', { phone });
    return { ok:true, found:false };
  } catch (err) {
    log.error('findClientByPhone', 'FAILED', err.response?.data || err);
    return { ok:false, found:false, err };
  }
}

/* =====================================================================
   1.  upsertClientRow  – core read / write
   ===================================================================== */
export async function upsertClientRow({ id, fullName = '', phone = '' }) {
  log.step('upsertClientRow', 'START', { id, fullName, phone });

  // ① – Fetch sheet
  let rows;
  try {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE_READ
    });
    rows = data.values ?? [];
    log.info('upsertClientRow', 'sheetFetched', { rows: rows.length });
  } catch (err) {
    log.error('upsertClientRow', 'sheetFetchFailed', err.response?.data || err);
    return emptyResult('sheets_read_failed');
  }
  if (!rows.length) return emptyResult('sheet_empty');

  // ② – Column map
  const headerRow   = rows[0];
  const IDX_ID      = idxByHeader(headerRow, 'ID');
  const IDX_NAME    = idxByHeader(headerRow, 'FullName');
  const IDX_PHONE   = idxByHeader(headerRow, 'Phone');
  const IDX_FOLDER  = idxByHeader(headerRow, 'DriveFolderId');
  if ([IDX_ID,IDX_NAME,IDX_PHONE,IDX_FOLDER].some(i => i === -1))
    return emptyResult('header_missing');

  // ③ – Search by ID
  const dataRows       = rows.slice(1);
  const idx            = dataRows.findIndex(r => r[IDX_ID] === id);
  const sheetRowNumber = idx !== -1 ? idx + 2 : null;  // +2 header + 1-based

  /* ---------- Existing row path ---------- */
  if (idx !== -1) {
    let row        = dataRows[idx];
    let nameCell   = row[IDX_NAME]   || '';
    let phoneCell  = row[IDX_PHONE]  || '';
    let folderId   = row[IDX_FOLDER] || null;

    log.step('upsertClientRow', 'FOUND_EXISTING', {
      sheetRowNumber, nameCell, phoneCell, folderId
    });

    // ③a – validate folder
    if (folderId) {
      try {
        const ok = await folderExists(folderId);
        if (!ok) {
          log.info('upsertClientRow', 'folder_missing_in_drive', { folderId });
          folderId = null; // wipe & clear in sheet
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!${String.fromCharCode(65+IDX_FOLDER)}${sheetRowNumber}`,
            valueInputOption: 'RAW',
            requestBody: { values: [['']] }
          });
        }
      } catch (err) { log.error('upsertClientRow','drive_check_failed',err); }
    }

    // ③b – fill blanks if client now provided
    const needName  = fullName && !nameCell;
    const needPhone = phone    && !phoneCell;
    if (needName || needPhone) {
      if (needName)  nameCell  = fullName;
      if (needPhone) phoneCell = phone;

      const updated = [...row];
      updated[IDX_NAME]   = nameCell;
      updated[IDX_PHONE]  = phoneCell;
      updated[IDX_FOLDER] = folderId || '';

      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `'${SHEET_NAME}'!A${sheetRowNumber}:Z${sheetRowNumber}`,
          valueInputOption: 'RAW',
          requestBody: { values: [updated] }
        });
        log.info('upsertClientRow','row_patched',{ sheetRowNumber });
      } catch (err) {
        log.error('upsertClientRow','row_update_failed',err.response?.data||err);
        return emptyResult('sheet_update_failed');
      }
      row = updated;
    }

    return { rowNumber: sheetRowNumber, driveFolderId: folderId,
             exists:true, row };
  }

  /* ---------- Insert new row ---------- */
  const newRow = [];
  newRow[IDX_ID]     = id;
  newRow[IDX_NAME]   = fullName;
  newRow[IDX_PHONE]  = phone;
  newRow[IDX_FOLDER] = '';

  try {
    const append   = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE_ALL,
      valueInputOption: 'RAW',
      requestBody: { values: [newRow] }
    });
    const rowNumber = Number(append.data.updates.updatedRange.match(/\d+$/)[0] || 0);
    log.step('upsertClientRow', 'NEW_ROW', { rowNumber });
    return { rowNumber, driveFolderId:null, exists:false, row:newRow };
  } catch (err) {
    log.error('upsertClientRow', 'rowAppendFailed', err.response?.data || err);
    return emptyResult('sheet_append_failed');
  }
}

/* =====================================================================
   2. updateDriveFolderId  – single-cell update
   ===================================================================== */
export async function updateDriveFolderId(rowNumber, folderId) {
  log.step('updateDriveFolderId', 'START', { rowNumber, folderId });

  let headers;
  try {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!1:1`
    });
    headers = data.values?.[0] || [];
  } catch (err) {
    log.error('updateDriveFolderId', 'header_fetch_failed', err);
    return false;
  }

  const IDX_FOLDER = headers.indexOf('DriveFolderId');
  if (IDX_FOLDER === -1) {
    log.error('updateDriveFolderId', 'header_missing_DriveFolderId', headers);
    return false;
  }

  const colLetter = String.fromCharCode(65 + IDX_FOLDER);
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!${colLetter}${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[folderId]] }
    });
    log.step('updateDriveFolderId', 'SUCCESS', { rowNumber });
    return true;
  } catch (err) {
    log.error('updateDriveFolderId', 'FAILED', err.response?.data || err);
    return false;
  }
}
