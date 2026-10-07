// Fake chrome.* APIs so the real extension pages render with sample data.
(() => {
  const lang = new URLSearchParams(location.search).get('lang') || 'en';
  const pl = lang === 'pl';
  const custom = 'Custom.289.13x430.87';
  const store = { settings: { language: lang, activeProfileId: 'ql', notifications: true,
    autoPrint: { enabled: true, domains: 'example-courier.com\nshop-panel.example' },
    profiles: [
      { id: 'ql', name: pl ? 'Drukarka etykiet' : 'Label printer', printer: 'Brother_QL_1110NWB', media: custom, paper: 'custom', paperW: 102, paperH: 152, unprintable: { l: 0, t: 0, r: 5, b: 0 }, printerScaling: 'none' },
      { id: 'a4', name: pl ? 'Drukarka A4 w biurze' : 'Office A4 printer', printer: 'Brother_DCP_9015CDW', media: 'A4', paper: 'A4', paperW: 210, paperH: 297, unprintable: { l: 4.2, t: 4.2, r: 4.2, b: 4.2 } },
      { id: 'zb', name: pl ? 'Zebra w magazynie' : 'Warehouse Zebra', printer: 'Zebra_ZD421', media: 'w288h432', paper: 'custom', paperW: 99.8, paperH: 149.9 },
    ] } };
  const now = Date.now();
  window.chrome = {
    runtime: { id: 'fcfpnegfonhlplflgmjapjgkdcpdfkma', getURL: (p) => '/ext/' + p, getManifest: () => ({ version: '2.0.3' }), openOptionsPage() {},
      sendMessage: async (m) => m.payload?.cmd === 'ping' ? { ok: true, version: '2.0.3', platform: 'darwin', format: 'pdf' }
        : m.payload?.cmd === 'printers' ? { ok: true, printers: window.PRINTERS } : { ok: false } },
    storage: { local: { get: async (k) => ({ [k]: structuredClone(store[k]) }), set: async (o) => Object.assign(store, structuredClone(o)) },
      session: { get: async () => ({}), set: async () => {} } },
    tabs: { create() {}, query: async () => [{ url: 'https://example-courier.com/label.pdf' }] },
    downloads: { search: async () => [
      { id: 1, filename: '/Users/me/Downloads/label_ORDER-48213.pdf', mime: 'application/pdf', startTime: new Date(now - 120000).toISOString() },
      { id: 2, filename: '/Users/me/Downloads/shipping-label-48207.pdf', mime: 'application/pdf', startTime: new Date(now - 1500000).toISOString() },
      { id: 3, filename: '/Users/me/Downloads/return-label-48190.pdf', mime: 'application/pdf', startTime: new Date(now - 7200000).toISOString() },
    ] },
  };
})();
