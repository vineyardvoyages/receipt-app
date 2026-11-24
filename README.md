# Receipts

A mobile-first Progressive Web App that photographs a receipt, reads the merchant, transaction date, and printed total, names the image, and saves it automatically to **Vineyard Voyages / Receipts** in Google Drive. You can also share or download the correctly named photo.

The app is static (plain HTML, CSS, and JavaScript). There is no build step. Serve the folder as-is, including from a GitHub Pages project site such as `https://USER.github.io/receipt-app/`. All paths are relative so a subpath deploy works.

## Filename and folder

- **Drive folder:** `Vineyard Voyages` / `Receipts` (you pick the parent or the Receipts folder once; Receipts is created if it does not exist yet)
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

The first time you save (or if you tap **Connect Google Drive**):

1. Sign in as **choeffel@gmail.com** when Google asks. The consent screen may say the app is unverified — tap **Continue**.
2. In the folder picker, open **Vineyard Voyages** and select **Receipts** if it already exists. If it does not, select **Vineyard Voyages** and the app will create a **Receipts** folder inside it.
3. After that, the home screen shows **Saving to: Vineyard Voyages / Receipts**. Use **Change folder** if you ever need to pick a different location.
4. On the confirm screen, tap **Save to Drive**. The photo uploads in one step. If you are offline, it is queued and uploads the next time the app is open and online.

Share and Download remain available as smaller links on the confirm screen.

## Install on Android (Chrome)

1. Open the hosted app URL in Chrome on your phone.
2. Tap the three-dot menu.
3. Tap **Install app** or **Add to Home screen**, then confirm.
4. Open **Receipts** from the home screen. It should launch full screen, without the Chrome address bar.

If you do not see **Install app**, use **Add to Home screen**. The site must be served over HTTPS (GitHub Pages is fine) and you should stay on the page for a moment so the service worker can register.


## Deploy to GitHub Pages (optional)

This repo is ready to publish as a GitHub Pages project site from the `main` branch (root, or `/docs` if you put these files there). After Pages is on, the app URL is typically:

`https://USER.github.io/receipt-app/`

Add that origin in the Google Cloud OAuth client as described above (`https://USER.github.io`).

## Limitations

- OCR (Tesseract.js, English) runs in the browser and can misread faded, crumpled, or low-contrast receipts. Always confirm the values.
- Dates that are ambiguous (for example `05/06/2026`) are parsed US-style, month first, and flagged for review.
- Photo compression downscales to a 1600px long edge at JPEG quality 0.7 and honors EXIF orientation where the browser supports it.
- Recent receipts are stored only on the device (`localStorage`), up to about 20 items.
