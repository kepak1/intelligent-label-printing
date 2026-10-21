# Intelligent label printing – user guide

**English** · [Polski](pl.md)

<!-- This is the reference version of the user guide. Translations: docs/guide/<language>.md (see TRANSLATING.md). -->

Intelligent label printing is a Chrome extension that finds the courier label in a PDF, crops the white space and prints it in one click on the printer you choose, either a label printer or a plain A4 printer.

## Installation

1. Install the extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/intelligent-label-printin/fcfpnegfonhlplflgmjapjgkdcpdfkma) and pin its icon to the toolbar.
2. Open the extension's settings (the gear icon in the extension popup). The print helper section has a download button for your system.
3. Install the print helper:
    - **Windows:** double-click the downloaded `.exe` file. If Windows SmartScreen appears, choose **More info → Run anyway**. No administrator rights are needed.
    - **macOS:** open the downloaded `.pkg` file. If macOS says the developer cannot be verified, open **System Settings → Privacy & Security** and click **Open Anyway**.
4. Restart Chrome and click **Check again** in the extension's settings. A green dot means everything works.

The helper is needed because Chrome does not let extensions print to a chosen printer without a dialog. Without it the extension still crops labels, but prints through the normal print dialog. The security warnings appear because the helper is not code-signed yet; its source code is public on [GitHub](https://github.com/kepak1/intelligent-label-printing).

## Setup

1. In the settings, choose a profile or add a new one.
2. Choose the **printer** from the list.
3. Choose the **media size in the driver** that matches the paper in the printer. The paper size and the non-printable edges are set automatically.
4. Set the profile you use most as **active**.

| Paper in the profile | Result |
| --- | --- |
| Label (A6, 100×150 mm, 4×6" or a custom size) | The label fills the whole label |
| A4 | The label in an A6 area (105×148 mm) with cut lines; optionally 2 or 4 per sheet |

Tips:
- **Custom paper sizes** from the macOS print dialog or from Windows ("Print server properties") are at the top of the list. Many label printers only print reliably with such a size.
- **★** marks the size last used for that printer in the macOS print dialog.
- **Several computers:** **Export to file** and **Import from file** move all profiles.

## Printing

| Where the label is | What to do |
| --- | --- |
| PDF open in a tab | Extension icon → **Print PDF from this tab** |
| Link to a PDF | Right-click the link → **Intelligent label printing → Print: (profile)** |
| Without the mouse | Shortcut **Alt+Shift+P** |
| A file you just downloaded | Extension popup → **Print** next to the file |
| A file on your disk | **Open file from disk…** or drag the file onto the preview page |

**Preview** shows the result before printing. **Automatic printing** (in the settings) prints PDFs downloaded from the sites you list.

## Printing a shipping code

If you get a code instead of a label, you can print it as a label:

1. In the settings, open **Shipping code label** and tick **Enable code printing**.
2. Choose the graphic code (QR code, barcode or none) and, if you like, a header, the date and time, and a daily sequence number.
3. In the extension popup, paste the code and press **Enter**. Or select the code on a page and right-click → **Print as code**.

On a label printer the code fills the whole label. With a long roll of continuous tape, open **Advanced** in the printer profile and turn on short prints. On an A4 printer the code is printed in a small area (A7) to cut out.

## Common problems

- **The printer blinks red and does not print:** the media size does not match the loaded roll. Choose the custom size you use in the system print dialog.
- **The label comes out in several pieces, or rotated and enlarged:** continuous tape was selected instead of die-cut labels. Choose the size that matches your labels.
- **The edges are clipped:** increase *Margin inside the label area* or set *Printer-side scaling* to *Fit to page*.
- **"No print helper":** the helper is not installed or Chrome cannot see it. The settings page shows the exact error and a hint.
- **Too much or too little was cropped:** change the *Cropping mode* in the profile.

Report bugs and ideas on [GitHub](https://github.com/kepak1/intelligent-label-printing/issues).
