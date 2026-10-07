# Privacy policy – Intelligent label printing

_Last updated: 7 October 2026_

Intelligent label printing (the Chrome extension and its helper app) is free, open-source software. It is built to work entirely on your computer.

## What the extension accesses
- **The PDF files you choose to print.** These come from the current tab, a link you right-click, a file you open, or your recent downloads. Shipping labels contain names and addresses. The extension reads these files only to crop and print them.
- **Your settings.** Printer profiles and options are stored locally in your browser (`chrome.storage`). If you use **Export to file**, they are saved to a file you choose.
- **Your printers.** The helper app lists the printers and paper sizes installed on your computer and sends print jobs to the printer you select.

## What we do not do
- We do not send your labels, files, settings or any other data to any server.
- We do not collect analytics, usage statistics or crash reports.
- We do not sell or share any data with anyone.
- The extension contains no advertising and no remote code.

## Network access
The extension downloads a PDF only when you ask it to print that PDF, from the same website your browser is already using (with your existing login). The only other links are the ones you click yourself: the GitHub page to download the helper, and the optional Ko-fi donation page.

## The helper app
The helper app runs only when the extension asks it to print, list printers, or read a PDF you selected. It reads only `.pdf` files. It does not connect to the internet.

## Contact
Questions or concerns: open an issue at https://github.com/kepak1/intelligent-label-printing/issues.
