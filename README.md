# ApoTune Diagnostic Dashboard

Small static HTML dashboard to make `diagnostic_log.json` files easier to read.

This project is fully client-side and can run in two ways:

1. Locally via `file:///.../index.html`
2. Publicly via GitHub Pages (shareable link for others)

## Project structure

- `index.html` - main dashboard page
- `styles.css` - dashboard styling
- `app.js` - JSON parsing and rendering logic
- `sample-data/diagnostic_log.sample.json` - sanitized demo file for testing
- `.github/workflows/pages.yml` - automatic GitHub Pages deployment

## Use locally (no server)

1. Open `index.html` directly in your browser.
2. Click **Choose JSON File** and select a diagnostic file.
3. Or drag and drop a JSON file into the drop zone.

## Publish for others (GitHub Pages)

### Option A: Automatic via included workflow (recommended)

1. Create a new GitHub repository.
2. Upload all files from this folder.
3. Push to branch `main`.
4. In GitHub, open **Settings -> Pages**.
5. Under **Source**, choose **GitHub Actions**.
6. Wait for workflow **Deploy Dashboard to GitHub Pages** to complete.

Your public URL will be:

`https://<your-username>.github.io/<your-repo-name>/`

### Option B: Branch deploy (without workflow)

1. In **Settings -> Pages**, choose **Deploy from a branch**.
2. Select `main` and folder `/ (root)`.
3. Save.

## Quick Git commands

```bash
git init
git add .
git commit -m "Initial diagnostic dashboard"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

## Privacy note

Real diagnostic logs can contain private machine, user, network, and path details.
Before publishing any JSON in the repository, sanitize sensitive fields.

Use `sample-data/diagnostic_log.sample.json` as a safe public example.
