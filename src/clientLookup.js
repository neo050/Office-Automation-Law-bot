// ─────────────────────────────────────────────────────────────────────────────
// clientLookup.js   ·   robust + ultra-verbose
// ─────────────────────────────────────────────────────────────────────────────
import { sheets }       from './gAuth.js';
import { log }          from './logger.js';
import { folderExists } from './driveUtils.js';

const SPREADSHEET_ID = process.env.SHEETS_ID;
const SHEET_NAME     = process.env.SHEET_NAME || 'Clients';

// We always read with the header row
const RANGE_READ = `'${SHEET_NAME}'!A1:Z`;   // Z gives head-room for extra cols
const RANGE_ALL  = `'${SHEET_NAME}'!A:Z`;

/* ─────────────── helpers ─────────────── */

function idxByHeader(headerRow, header) {
  const i = headerRow.indexOf(header);
  if (i === -1) {
    log.error('clientLookup', `header_missing_${header}`, headerRow);
  }
  return i;
}

function emptyResult(reason) {
  /* uniform error object so caller can inspect .error */
  return { error: reason, rowNumber: null, driveFolderId: null, exists: false, row: [] };
}

/* ─────────────── main API ─────────────── */

/**
 * Upsert a client row; verify Drive folder if present.
 * @returns {
 *   rowNumber: number|null,
 *   driveFolderId: string|null,
 *   exists: boolean,
 *   row: any[],
 *   error?: string
 * }
 */
export async function upsertClientRow({ id, fullName = '', phone = '' }) {
  log.step('clientLookup.upsertClientRow', 'START', { id, fullName, phone });

  /* 1️⃣  Fetch rows ---------------------------------------------------- */
  let rows;
  try {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE_READ
    });
    rows = data.values ?? [];
    log.info('clientLookup', 'sheetFetched', { totalRows: rows.length });
  } catch (err) {
    log.error('clientLookup', 'sheetFetchFailed', err.response?.data || err);
    return emptyResult('sheets_read_failed');
  }

  if (rows.length === 0) {
    log.error('clientLookup', 'empty_sheet', null);
    return emptyResult('sheet_empty');
  }

  /* 2️⃣  Build column map --------------------------------------------- */
  const headerRow   = rows[0];
  const IDX_ID      = idxByHeader(headerRow, 'ID');
  const IDX_NAME    = idxByHeader(headerRow, 'FullName');
  const IDX_PHONE   = idxByHeader(headerRow, 'Phone');
  const IDX_FOLDER  = idxByHeader(headerRow, 'DriveFolderId');

  if ([IDX_ID, IDX_NAME, IDX_PHONE, IDX_FOLDER].some(i => i === -1)) {
    return emptyResult('header_missing');
  }

  /* 3️⃣  Search for existing client ----------------------------------- */
  const dataRows = rows.slice(1);           // exclude header
  const idx      = dataRows.findIndex(r => r[IDX_ID] === id);
  const sheetRowNumber = idx !== -1 ? idx + 2 : null; // +2 => skip header + 1-based

  if (idx !== -1) {
    /* Existing row path */
    let row      = dataRows[idx];
    let nameCell   = row[IDX_NAME]   || '';
    let phoneCell  = row[IDX_PHONE]  || '';
    let folderId   = row[IDX_FOLDER] || null;

    log.step('clientLookup.upsertClientRow', 'FOUND_EXISTING', {
      sheetRowNumber, nameCell, phoneCell, folderId
    });

    /* 3a. Validate folderId */
    if (folderId) {
      try {
        const exists = await folderExists(folderId);
        log.info('clientLookup', 'folderCheck', { folderId, exists });
        if (!exists) {
          log.info('clientLookup', 'folderInvalid_clearingInSheet', { folderId });
          folderId = null;
          await sheets.spreadsheets.values.update({
            spreadsheetId  : SPREADSHEET_ID,
            range          : `'${SHEET_NAME}'!${String.fromCharCode(65+IDX_FOLDER)}${sheetRowNumber}`,
            valueInputOption: 'RAW',
            requestBody    : { values: [['']] }
          });
        }
      } catch (err) {
        log.error('clientLookup', 'drive_check_failed', err);
        // keep folderId as-is; non-fatal
      }
    }

    /* 3b. Fill missing values if provided now */
    const needName  = fullName && !nameCell;
    const needPhone = phone && !phoneCell;
    if (needName || needPhone) {
      if (needName)  nameCell  = fullName;
      if (needPhone) phoneCell = phone;

      const updatedRow = [...row];               // clone row
      updatedRow[IDX_NAME]   = nameCell;
      updatedRow[IDX_PHONE]  = phoneCell;
      updatedRow[IDX_FOLDER] = folderId || '';

      log.info('clientLookup', 'updating_row', { sheetRowNumber, updatedRow });

      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId  : SPREADSHEET_ID,
          range          : `'${SHEET_NAME}'!A${sheetRowNumber}:Z${sheetRowNumber}`,
          valueInputOption: 'RAW',
          requestBody    : { values: [updatedRow] }
        });
      } catch (err) {
        log.error('clientLookup', 'row_update_failed', err.response?.data || err);
        return emptyResult('sheet_update_failed');
      }
      row = updatedRow;
    }

    log.step('clientLookup.upsertClientRow', 'RETURNING_EXISTING', {
      sheetRowNumber, folderId, nameCell, phoneCell
    });
    return {
      rowNumber    : sheetRowNumber,
      driveFolderId: folderId,
      exists       : true,
      row
    };
  }

  /* 4️⃣  Insert new row ----------------------------------------------- */
  log.step('clientLookup.upsertClientRow', 'CREATING_NEW', { id, fullName, phone });
  const newRow = [];
  newRow[IDX_ID]     = id;
  newRow[IDX_NAME]   = fullName;
  newRow[IDX_PHONE]  = phone;
  newRow[IDX_FOLDER] = '';

  try {
    const append = await sheets.spreadsheets.values.append({
      spreadsheetId  : SPREADSHEET_ID,
      range          : RANGE_ALL,
      valueInputOption: 'RAW',
      requestBody    : { values: [newRow] }
    });
    const rowNumber = Number(append.data.updates.updatedRange.match(/\d+$/)[0]);
    log.step('clientLookup.upsertClientRow', 'NEW_ROW_CREATED', { rowNumber });
    return {
      rowNumber,
      driveFolderId: null,
      exists: false,
      row: newRow
    };
  } catch (err) {
    log.error('clientLookup', 'rowAppendFailed', err.response?.data || err);
    return emptyResult('sheet_append_failed');
  }
}

/**
 * Update only the DriveFolderId cell (column mapped by header).
 */
export async function updateDriveFolderId(rowNumber, folderId) {
  log.step('clientLookup.updateDriveFolderId', 'START', { rowNumber, folderId });

  /* Fetch header to locate column each time – protects against re-ordering */
  let headers;
  try {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!1:1`
    });
    headers = data.values?.[0] || [];
  } catch (err) {
    log.error('clientLookup.updateDriveFolderId', 'header_fetch_failed', err);
    return false;
  }

  const IDX_FOLDER = headers.indexOf('DriveFolderId');
  if (IDX_FOLDER === -1) {
    log.error('clientLookup.updateDriveFolderId', 'header_missing_DriveFolderId', headers);
    return false;
  }

  const colLetter = String.fromCharCode(65 + IDX_FOLDER);
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId  : SPREADSHEET_ID,
      range          : `'${SHEET_NAME}'!${colLetter}${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody    : { values: [[folderId]] }
    });
    log.step('clientLookup.updateDriveFolderId', 'SUCCESS', { rowNumber });
    return true;
  } catch (err) {
    log.error('clientLookup.updateDriveFolderId', 'FAILED', err.response?.data || err);
    return false;
  }
}
