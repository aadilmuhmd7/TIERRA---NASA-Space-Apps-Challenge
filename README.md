# TIERRA — Terrestrial Analog Explorer

## Files
- index.html, style.css, script.js : the application (keep in one folder)
- locations.json : research records (source of truth) + methodology text
- locations.template.json : one blank record showing every field
- images/ : put your Earth and planetary images here

## Run locally
1. Open a terminal in this folder.
2. python -m http.server 8000
3. Open http://localhost:8000  (opening index.html by double-click will not work)

## Enter research (two ways)
A) In the app: click Data > New research record, or select a pin > Edit record.
   Browser edits are saved in this browser only. They do NOT change locations.json.
B) Publish: Data > Export JSON downloads a complete locations.json.
   Replace the one in this folder with it, then upload to GitHub.

## Images
Images belong to the overall location record (there is no limit on the number of images per location).
You can add images in two ways:
1. Upload directly from your computer using the **Upload image…** button in the Record Editor (under Section 01: Location identification).
2. Place image files in the `images/` directory (e.g. `images/atacama-earth.jpg`) or use a full `https://` URL, and enter the path in the image field.

## Overview GIF
The blue title bar above Research Inventory has been replaced by a GIF container ready for your animation.
To display your GIF:
1. Place your GIF file in the `images/` folder (e.g. `images/overview.gif`).
2. Open `script.js` and set `const OVERVIEW_GIF_SRC = "images/overview.gif";` near the top of the file.

## Local edits vs the file
A local edit replaces the record with the same id in locations.json. "Revert to file"
removes your edit. After you replace locations.json with an export, use
Data > Clear local edits so the file and the browser agree.
