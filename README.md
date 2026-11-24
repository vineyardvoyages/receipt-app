# Receipts

A mobile-first Progressive Web App that photographs a receipt, reads the merchant, transaction date, and printed total, names the image, and saves it automatically to **Vineyard Voyages / Receipts** in Google Drive.

The app is static (plain HTML, CSS, and JavaScript). There is no build step. Serve the folder as-is, including from a GitHub Pages project site such as `https://USER.github.io/receipt-app/`. All paths are relative so a subpath deploy works.

## Filename and folder

- **Drive folder:** `Vineyard Voyages` / `Receipts` in choeffel@gmail.com's Drive. Anyone who opens the app can add files there; no Google sign-in or folder picker is shown.
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


## Google Drive

Saving does not ask anyone to sign in or pick a folder. **Save to Drive** posts the JPEG to a Google Apps Script web app owned by **choeffel@gmail.com**. That script writes the file into **Vineyard Voyages / Receipts** and returns a link. If you are offline, the photo is queued on the device and uploads the next time the app is open and online.

Save to Drive is the only save action. While uploading, the button shows **Saving…** with a spinner. On success a green banner shows **Saved to Drive ✓ filename** with an Open link, and the receipt shows ✓ in Recent receipts. If an upload fails, a red message gives the reason, the photo is queued on the device, and a **Retry upload** button appears. Queued uploads also retry automatically when the app opens or comes back online.

The footer shows the app version (for example `Receipts v6 · 2026-11-23`), so you can confirm the phone is running the latest code. New versions activate automatically and reload the page.

### Deploy the upload script (owner)

The PWA talks to the web app defined in `apps-script/`. Until a deployment URL is pasted into `config.js` (`UPLOAD_URL`), Save to Drive stays disabled and shows that upload is not configured yet.

1. In a browser signed in as **choeffel@gmail.com**, open [script.google.com](https://script.google.com), start a new project, and paste `apps-script/Code.gs` and `apps-script/appsscript.json`.
2. Deploy → New deployment → type **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Authorize Drive access when asked.
3. Copy the `/exec` URL and put it in `config.js` as `UPLOAD_URL`. Leave `UPLOAD_TOKEN` matching the `UPLOAD_TOKEN` constant in `Code.gs` (it is a light anti-spam check; it is visible in the client).
4. A `GET` to that URL should return `{"ok":true}`.

## Install on Android (Chrome)

1. Open the hosted app URL in Chrome on your phone.
2. Tap the three-dot menu.
3. Tap **Install app** or **Add to Home screen**, then confirm.
4. Open **Receipts** from the home screen. It should launch full screen, without the Chrome address bar.

If you do not see **Install app**, use **Add to Home screen**. The site must be served over HTTPS (GitHub Pages is fine) and you should stay on the page for a moment so the service worker can register.


## Deploy to GitHub Pages (optional)

This repo is ready to publish as a GitHub Pages project site from the `main` branch (root, or `/docs` if you put these files there). After Pages is on, the app URL is typically:

`https://USER.github.io/receipt-app/`

After the Apps Script web app is deployed, put its `/exec` URL in `config.js` (`UPLOAD_URL`) before you rely on Save to Drive from the live site.

## Limitations

- OCR (Tesseract.js, English) runs in the browser and can misread faded, crumpled, or low-contrast receipts. Always confirm the values.
- Dates that are ambiguous (for example `05/06/2026`) are parsed US-style, month first, and flagged for review.
- Photo compression downscales to a 1600px long edge at JPEG quality 0.7 and honors EXIF orientation where the browser supports it.
- Recent receipts are stored only on the device (`localStorage`), up to about 20 items.
- Anyone with the app URL can add JPEG receipts to the owner's Drive folder. The shared token in `config.js` is only a light anti-spam measure, not a login.
- The Apps Script web app must already exist, and `Vineyard Voyages` must already be in the owner's My Drive. The script creates `Receipts` inside it if needed, but it will not create `Vineyard Voyages`.
