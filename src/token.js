import fs from 'fs/promises';
import { google } from 'googleapis';
import readline from 'node:readline/promises';

const creds = JSON.parse(await fs.readFile('client_secret.json'));
const { client_id, client_secret } = creds.installed;

const oAuth2 = new google.auth.OAuth2(
  client_id,
  client_secret,
  'urn:ietf:wg:oauth:2.0:oob'
);

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
];

const authUrl = oAuth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
console.log('Authorize this app by visiting this url:\n', authUrl);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const code = await rl.question('\nEnter the code here: ');
rl.close();

const { tokens } = await oAuth2.getToken(code.trim());
await fs.writeFile('config/token.json', JSON.stringify(tokens, null, 2));
console.log('Token stored to config/token.json');
