# Intelligent label printing

**[➜ Install from the Chrome Web Store](https://chromewebstore.google.com/detail/intelligent-label-printin/fcfpnegfonhlplflgmjapjgkdcpdfkma)** · [Download the helper](https://github.com/kepak1/intelligent-label-printing/releases/latest) · [Support on Ko-fi](https://ko-fi.com/kepak1)

A Chrome extension that prints courier labels in one click. The label in the PDF can fill a whole A6 page or sit on a quarter of an A4 page. Either way, the extension:

1. renders each PDF page and detects its content (the label),
2. crops the white margins. In automatic mode it also skips small text next to the label and splits several labels on one A4 page into separate labels,
3. builds a new PDF that fits the paper loaded in the printer of the selected profile,
4. sends it straight to that printer through a small helper program, with no print dialog (macOS: CUPS `lp`; Windows: the printer driver).

| Paper in the profile | Result |
|---|---|
| **A4** | the label in an A6 area (105×148 mm) in the chosen corner of the sheet, with cut lines; optionally 2 or 4 labels per sheet |
| **A6 / 100×150 / 4×6" / custom** | the label scaled and rotated to fill the whole page |

**Free and open source, forever.** No subscription, no trial, no account, no paid tier: every feature is free for everyone. Labels are processed only on your computer and never uploaded anywhere (see the [privacy policy](PRIVACY.md)).

The interface is in English by default. Polish is available: switch it in the popup (EN/PL) or under **Settings → Language**.

## Installation

### 1. Print helper (once)
Chrome does not let extensions print to a chosen printer without showing a dialog, so the extension uses a small helper program. The extension's settings page detects when the helper is missing or outdated and shows the right download button.

**macOS**: download and open `LabelPrintingHelper-macOS.pkg`.
- The installer is not signed yet. If macOS says the developer cannot be verified, open **System Settings → Privacy & Security** and click **Open Anyway**.
- The helper is installed in `/Library/Application Support/IntelligentLabelPrinting/` and registered with Chrome, Edge, Brave and Chromium.
- To uninstall, run: `sudo "/Library/Application Support/IntelligentLabelPrinting/ilp-host" uninstall --system`.

**Windows**: download `LabelPrintingHelper-Windows-x64.exe` (or `-arm64.exe` for Windows on ARM) and double-click it.
- It copies itself to `%LOCALAPPDATA%\IntelligentLabelPrinting` and registers with Chrome, Edge, Brave, Chromium and Vivaldi. No administrator rights are needed.
- The file is not signed yet. If SmartScreen appears, click **More info → Run anyway**.
- To uninstall, run: `"%LOCALAPPDATA%\IntelligentLabelPrinting\ilp-host.exe" uninstall`.
- Windows has no built-in PDF printing, so the extension renders each label at the printer's own resolution and the helper prints it through the driver with the exact paper size. Custom sizes work as well: forms created in *Print server properties* appear at the top of the media list.

**Developer install (macOS, no admin rights)**:
```bash
bash ~/Labelprinter/helper/build.sh
```
```bash
~/Labelprinter/dist/ilp-host-macos install
```

### 2. The extension
Install it from the **[Chrome Web Store](https://chromewebstore.google.com/detail/intelligent-label-printin/fcfpnegfonhlplflgmjapjgkdcpdfkma)**, then pin the icon to the toolbar. It also works in Edge, Brave and other Chromium browsers.

Without the store (development or testing):
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension` folder of the project, or the unzipped `extension-unpacked.zip` from the release. Don't use the Chrome Web Store zip: it gets a different ID.
3. Both ways give the same extension ID, `fcfpnegfonhlplflgmjapjgkdcpdfkma`, which matches the helper. Keep only one copy installed at a time.

### 3. Profiles
In the extension settings, assign a printer to each profile (the list comes from the system) and pick the **media size in the driver**.

The extension reads every media size's real dimensions and non-printable edges from the printer driver:

- **The paper size follows the media size.** It is shown as a read-only line (e.g. *Paper: 102 × 152 mm – taken from the media size above*), so the paper and the driver media can't get out of sync. A4 media switches to the cut-to-A6 layout.
- **You set the paper by hand only when there is nothing to derive it from**: the profile has no printer, the media size is unknown, or you chose **Custom size = paper set below**, in which case that size is sent to the printer.
- **The non-printable edges are applied automatically**, so nothing gets clipped.

#### Custom paper sizes
- **macOS custom sizes.** Sizes you created in the macOS print dialog (*Paper size → Manage Custom Sizes…*) appear at the top of the media list.
- **Last used size.** The size you last used for a printer in the macOS dialog is marked with ★. It is also selected automatically when you pick that printer.
- **Custom size = paper set below.** This option sends the profile's paper size to the printer as a custom size, e.g. `Custom.102x152mm`.

Many label printers, the Brother QL among them, print reliably only with the custom size you already use in the system dialog. If a predefined size makes the printer blink red, choose your custom size.

#### Brother QL (e.g. QL-1100 / QL-1110NWB)
- **Die-cut 102×152 mm labels (DK-11241)**: choose `102 mm x 152 mm · DC16`.
- **Continuous tape**: avoid `102mm`, `102mmx2`, `102mmx3` and similar. These are continuous-tape sizes with a 100 mm tall *landscape* page (`102mmx3` is about 299×100 mm). With 4×6" labels, the driver will scale, rotate and cut the label into several pieces.

#### Thermal printers (e.g. ITPP130, Zebra)
- Choose the size that matches your labels, e.g. `w288h432` for 4×6".

## Usage
- **Popup**: choose a profile, then click **Print PDF from this tab**, or click **Print** next to one of the recently downloaded PDFs.
- **Right-click** a PDF link or a page: *Intelligent label printing → Print: <profile>*.
- **Shortcut** `Alt+Shift+P`: prints the PDF in the current tab with the active profile.
- **Automatic printing** (optional): PDFs downloaded from the listed domains print by themselves.
- **Preview**: shows the cropping result (sizes, scale, rotation) and lets you compare profiles before printing.

## Moving settings to another computer
In **Settings → Backup & transfer**, click **Export to file** to save all profiles and settings as a JSON file. On the other computer, click **Import from file…** and choose one of two options:
- **Replace all settings**: the file becomes the full configuration.
- **Add / update profiles**: profiles with the same name or ID are updated and the rest are added.

Printer names are matched ignoring punctuation, so `Brother_QL_1110NWB` (macOS) matches `Brother QL-1110NWB` (Windows). For any printer that isn't found, the page lists the profiles that need a printer chosen.

## Troubleshooting
- **The printer blinks red and does not print.** The media size in the job does not match the loaded roll. Select the custom size you normally use in the macOS print dialog (marked ★).
- **The label comes out in several pieces, or rotated and enlarged.** The selected media doesn't match the labels loaded in the printer, e.g. continuous tape instead of die-cut labels. Choose the media that matches your roll. The settings page warns when the media is continuous tape.
- **The edges are clipped.** Increase *Margin inside the label area*, or set *Printer-side scaling* to *Fit to page*.
- **"No print helper".** The settings page shows Chrome's exact error and a hint:
  - *not found*: the helper isn't registered. Run the installer again and close Chrome completely before reopening it.
  - *forbidden*: the extension has a different ID than the helper expects. Load `extension-unpacked.zip`, or allow the ID with the command shown on the page (`ilp-host install --extension-id <ID>`).
  - *exited / failed to start*: the helper was blocked or crashed. Check your antivirus.
- **Check the helper registration**: on Windows, double-click the helper again, or run `ilp-host status` (macOS: `"/Library/Application Support/IntelligentLabelPrinting/ilp-host" status --system`).
- **Windows: wrong size or blank page.** Choose the matching paper in *Media size in the driver*. Many label printer drivers on Windows only accept their own paper sizes or a form created in *Print server properties*.

## Project structure
```
extension/        Chrome extension (Manifest V3)
  engine.js       content detection and PDF composition (pdf.js + pdf-lib)
  background.js   fetching PDFs, context menu, printing through the helper
  i18n.js         UI translations (English, Polish)
  popup.*, options.*, print.*   user interface
  _locales/       extension name and description for the Chrome Web Store / chrome://extensions
  config.js       project links: helper downloads, donation pages, minimum helper version
helper/           Native Messaging helper in Go (one binary, no dependencies)
  print_cups.go   macOS / Linux printing (CUPS)
  print_windows.go  Windows printing (winspool + GDI)
  install_*.go    self-registration with the browsers
  build.sh        builds everything into dist/
keys/             the extension's private key – keep it safe, never publish it
test-pdfs/        sample labels for testing
```

Requirements: Chrome 120 or newer (or Edge, Brave), on macOS 11+, Windows 10/11 or Linux with CUPS.

## Building and releasing
Install Go once (e.g. `brew install go`), then build everything:

```bash
bash helper/build.sh
```

The build writes these files to `dist/`:

| File | Purpose |
|---|---|
| `LabelPrintingHelper-macOS.pkg` | macOS installer (Intel + Apple Silicon) |
| `LabelPrintingHelper-Windows-x64.exe` | Windows helper |
| `LabelPrintingHelper-Windows-arm64.exe` | Windows helper for ARM |
| `extension-unpacked.zip` | the extension for **Load unpacked**. It keeps the extension ID the helper expects. |
| `extension-chrome-web-store.zip` | package for Chrome Web Store updates. It is built locally and not attached to GitHub releases. Don't load it unpacked: without the key, Chrome gives it a different ID and the helper refuses it. |
| `extension-webstore-first-upload.zip` | package for the **first** Web Store upload. It contains `key.pem`, so the store keeps the same extension ID the helper expects. Never share it. |

Release checklist:
1. Bump `Version` in `helper/main.go`, `MIN_HELPER_VERSION` in `extension/config.js` (if the extension needs the new helper), and `version` in `extension/manifest.json`.
2. Run `helper/build.sh`.
3. Upload the installers to a GitHub release. The download buttons in the settings point to `releases/latest/download/<file name>`, which is set in `extension/config.js`.
4. Upload `extension-chrome-web-store.zip` to the Chrome Web Store.

## Donations
The **☕ Support the project** button in the settings opens the page set in `extension/config.js`:
- `donate`: e.g. Ko-fi;
- `donatePl`: e.g. buycoffee.to, used when the UI is in Polish.

The button is hidden while both are empty.

## Support
If the extension saves you time, you can support it on [Ko-fi](https://ko-fi.com/kepak1). Donations go towards code-signing certificates, so the helper installs without security warnings on macOS and Windows.

## License
MIT – see [LICENSE](LICENSE). pdf.js (Apache 2.0) and pdf-lib (MIT) keep their own licenses.
