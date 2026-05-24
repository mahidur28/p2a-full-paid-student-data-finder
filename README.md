# P2A Full Paid Student Data Finder

A single-page web app that searches student records across Google Sheets tabs
(via a Google Apps Script backend) and presents a clean, visual report.

## Features
- **Live search** by Email, WhatsApp number, or Name (debounced, with client-side caching)
- **Instant loading skeletons** for a fast, responsive feel
- **KPI cards**: total entries, total paid, identified batches, average paid/entry
- **Charts**: batch revenue bar chart + batch-share doughnut chart
- **Core Profile Identity** with a Full Paid / Not a Full Paid status badge
- **Academic Enrollment Sheets History** table (Sheet Origin, Admission Batch, Paid Amount)
- **Paid Amount Breakdown** visual bars
- **Export** to PDF, Excel, and Word
- Light / dark theme toggle

## Usage
Open `index.html` in any modern browser, or host it for free with **GitHub Pages**:
1. Push these files to a GitHub repository.
2. Go to **Settings → Pages**.
3. Set the source to your default branch (root) and save.
4. Your app will be live at `https://<username>.github.io/<repo>/`.

## Configuration
The backend endpoint is set in `index.html`:
```js
const WEB_APP_URL = "https://script.google.com/macros/s/.../exec";
```
Replace this with your own Google Apps Script Web App URL if needed.

## Tech
Plain HTML + Tailwind CSS (CDN) + Chart.js. No build step required.
