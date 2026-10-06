// Project links. Fill these in before publishing.
export const LINKS = {
  // GitHub releases page with the helper installers (.pkg / .exe).
  releases: 'https://github.com/kepak1/intelligent-label-printing/releases/latest',
  // Direct downloads of the latest helper installers (asset names produced by helper/build.sh).
  helperMac: 'https://github.com/kepak1/intelligent-label-printing/releases/latest/download/LabelPrintingHelper-macOS.pkg',
  helperWindows: 'https://github.com/kepak1/intelligent-label-printing/releases/latest/download/LabelPrintingHelper-Windows-x64.exe',
  helperWindowsArm: 'https://github.com/kepak1/intelligent-label-printing/releases/latest/download/LabelPrintingHelper-Windows-arm64.exe',
  // Donations (they fund code signing of the installers). Empty = button hidden.
  donate: 'https://ko-fi.com/kepak1',
  donatePl: '', // optional separate page for the Polish UI, e.g. buycoffee.to
};

// Oldest helper version this extension works with.
export const MIN_HELPER_VERSION = '2.0.0';

export function donateUrl(language) {
  return (language === 'pl' && LINKS.donatePl) || LINKS.donate || LINKS.donatePl || '';
}

export function helperConfigured() {
  return !LINKS.releases.includes('/OWNER/');
}

export function versionLess(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  }
  return false;
}
