import { google } from 'googleapis';
import 'dotenv/config';

(async () => {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const id = process.env.SHEETS_ID;

  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  console.log('Sheets in doc:', meta.data.sheets.map(s => s.properties.title));

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'Clients'!A1:D`
  });
  console.log('Values:', res.data.values);
})();
