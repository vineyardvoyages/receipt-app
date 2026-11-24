# Receipts

A mobile-first Progressive Web App that photographs a receipt, reads the merchant, transaction date, and printed total, names the image, and saves it to a Google Drive folder called **Receipts**. You can also share or download the correctly named photo if Drive is not set up.

The app is static (plain HTML, CSS, and JavaScript). There is no build step. Serve the folder as-is, including from a GitHub Pages project site such as `https://USER.github.io/receipt-app/`. All paths are relative so a subpath deploy works.

## Filename and folder

- **Drive folder name:** `Receipts` (created automatically if this app has not created it yet)
- **Filename format:** `Merchant YYYY-MM-DD $225.00.jpg` (for example `Fabbioli Cellars 2026-11-21 $270.00.jpg`)
  - Amounts are always US dollars and always use `$`
  - If you enter a tip, the amount in the filename is the printed total plus the tip
  - If no merchant is found, the name falls back to `YYYY-MM-DD $225.00.jpg`
  - Amounts always have two decimal places

On-device OCR is imperfect. The confirm screen always lets you edit the merchant, date, and amount, and add an optional tip, before saving. Uncertain fields are highlighted. Photos that are sideways are rotated automatically; you can also tap **Rotate** to turn the image and read it again.

## Run locally

From this directory:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/` (or `http://127.0.0.1:8080/`). Service workers and camera capture require a local or HTTPS origin, not a `file://` URL.

Parser unit tests (Node, no extra packages):

```bash
node test/parse.test.js
```

## Install on Android (Chrome)

1. Open the hosted app URL in Chrome on your phone.
2. Tap the three-dot menu.
3. Tap **Install app** or **Add to Home screen**, then confirm.
4. Open **Receipts** from the home screen. It should launch full screen, without the Chrome address bar.

If you do not see **Install app**, use **Add to Home screen**. The site must be served over HTTPS (GitHub Pages is fine) and you should stay on the page for a moment so the service worker can register.

## Set the Google Client ID (Drive uploads)

Drive upload is optional. If `GOOGLE_CLIENT_ID` in `config.js` is empty, the Drive button is hidden and you can still **Share** (on Android, pick Google Drive and the Receipts folder) or **Download** the named JPEG.

To enable **Save to Google Drive**:

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project (or pick an existing one).
2. Enable the **Google Drive API** for that project (APIs & Services → Library → Google Drive API → Enable).
3. Configure the **OAuth consent screen**:
   - User type: **External**
   - Publishing status can stay **Testing**
   - Add your Gmail address as a **test user** (required while the app is in testing)
   - Scopes: you can keep the defaults in the consent screen UI; the app requests `https://www.googleapis.com/auth/drive.file` at sign-in time (it can only see files it created)
4. Create an **OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins** must include the exact origin of the site, with no path. Examples:
     - `https://USER.github.io`
     - `http://localhost:8080` (for local testing)
   - You do not need a redirect URI for this app’s token client.
5. Copy the client ID into `config.js`:

```js
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
```

6. Redeploy or refresh the site. The first Drive save will prompt you to sign in and allow access.

Notes:

- The `drive.file` scope cannot see a Receipts folder you created yourself in Drive. The app finds a Receipts folder **it** created, or creates one.
- Authorized origins are origins only (`https://USER.github.io`), not `https://USER.github.io/receipt-app/`.

## Deploy to GitHub Pages (optional)

This repo is ready to publish as a GitHub Pages project site from the `main` branch (root, or `/docs` if you put these files there). After Pages is on, the app URL is typically:

`https://USER.github.io/receipt-app/`

Add that origin in the Google Cloud OAuth client as described above (`https://USER.github.io`).

## Limitations

- OCR (Tesseract.js, English) runs in the browser and can misread faded, crumpled, or low-contrast receipts. Always confirm the values.
- Dates that are ambiguous (for example `05/06/2026`) are parsed US-style, month first, and flagged for review.
- Photo compression downscales to a 1600px long edge at JPEG quality 0.7 and honors EXIF orientation where the browser supports it.
- Recent receipts are stored only on the device (`localStorage`), up to about 20 items.
