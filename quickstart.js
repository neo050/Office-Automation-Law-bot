// quickstart.js  (שמור ליד client_secret.json)
import fs from 'fs/promises';
import { google } from 'googleapis';

(async () => {
  const creds = JSON.parse(await fs.readFile('client_secret.json'));
  const { client_id, client_secret } = creds.installed;

  const oAuth2 = new google.auth.OAuth2(
    client_id,
    client_secret,
    'urn:ietf:wg:oauth:2.0:oob'        // redirect for desktop
  );

  const authUrl = oAuth2.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file']
  });

  console.log('🔑 1) Visit this URL:\n', authUrl);

  // בקוד המשתמש: הדבק כאן את ה-code שמופיע בדפדפן
  const code = await new Promise(r => {
    process.stdout.write('\n🔑 2) Paste the code here: ');
    process.stdin.once('data', d => r(d.toString().trim()));
  });

  const { tokens } = await oAuth2.getToken(code);
  await fs.writeFile('token.json', JSON.stringify(tokens));
  console.log('✅ token.json saved!');
})();
