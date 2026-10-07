#!/usr/bin/env python3
"""Builds store/publish-helper.html: a checklist with copy buttons for filling
in the Chrome Web Store developer dashboard, generated from store/LISTING.md."""
import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
listing = open(os.path.join(HERE, "LISTING.md"), encoding="utf-8").read()


def section(title, start_after=None):
    """Text under a '### title' heading, up to the next heading or ---."""
    text = listing if start_after is None else listing[listing.index(start_after):]
    m = re.search(r"^### " + re.escape(title) + r"[^\n]*\n(.*?)(?=^### |^## |^---)", text, re.S | re.M)
    if not m:
        raise SystemExit(f"Section not found: {title}")
    # the store shows plain text: drop markdown bold markers
    return m.group(1).strip().replace("**", "")


def permissions():
    rows = {}
    block = listing[listing.index("### Permission justifications"):listing.index("### Remote code")]
    for line in block.splitlines():
        m = re.match(r"\| `?([^|`]+?)`?(?: \(`<all_urls>`\))? \| (.+) \|$", line)
        if m and m.group(1) not in ("Permission", "---"):
            rows[m.group(1).strip()] = m.group(2).strip()
    return rows


en_desc = section("Detailed description")
pl_desc = section("Pełny opis")
single = section("Single purpose")
perms = permissions()
privacy_url = section("Privacy policy URL")
img = os.path.join(ROOT, "store", "images")
dist = os.path.join(ROOT, "dist")

steps = []


def step(title, items, note=""):
    steps.append({"title": title, "items": items, "note": note})


def copy(label, value):
    return {"type": "copy", "label": label, "value": value}


def info(label, value):
    return {"type": "info", "label": label, "value": value}


def files(label, paths):
    return {"type": "files", "label": label, "paths": paths}


step("1. Upload the package", [
    info("Where", "Developer dashboard → “New item” (Nowy element)"),
    files("File to upload (first upload only – it contains the private key, do not share it)",
          [os.path.join(dist, "extension-webstore-first-upload.zip")]),
], "After the upload the dashboard shows the item ID. It should be fcfpnegfonhlplflgmjapjgkdcpdfkma – tell Claude if it is different.")

step("2. Store listing – English (default language)", [
    copy("Description", en_desc),
    info("Category", "Tools (Narzędzia)"),
    info("Language", "English"),
    files("Store icon (128×128)", [os.path.join(ROOT, "extension", "icons", "icon128.png")]),
    files("Screenshots – in this order", [os.path.join(img, f"screenshot-{i}-en.png") for i in range(1, 6)]),
    files("Small promo tile (440×280)", [os.path.join(img, "promo-small-440x280-en.png")]),
    files("Marquee promo tile (1400×560)", [os.path.join(img, "promo-marquee-1400x560-en.png")]),
    copy("Homepage URL", "https://github.com/kepak1/intelligent-label-printing"),
    copy("Support URL", "https://github.com/kepak1/intelligent-label-printing/issues"),
], "Name and short description come from the package (extension/_locales) and are already set.")

step("3. Store listing – Polish", [
    info("How", "In the language selector of the Store listing tab, add “Polski”, then fill in:"),
    copy("Opis", pl_desc),
    files("Zrzuty ekranu – w tej kolejności", [os.path.join(img, f"screenshot-{i}-pl.png") for i in range(1, 6)]),
    files("Mały kafelek promocyjny", [os.path.join(img, "promo-small-440x280-pl.png")]),
    files("Duży baner", [os.path.join(img, "promo-marquee-1400x560-pl.png")]),
])

perm_items = [copy("Single purpose description", single)]
for name, text in perms.items():
    perm_items.append(copy(f"Justification: {name}", text))
perm_items += [
    info("Are you using remote code?", "No, I am not using remote code"),
    info("Data usage – what does the item collect",
         "Tick “Personally identifiable information” and “Website content” (labels contain names and addresses and are read from websites)."),
    info("Certifications", "Tick all three: not selling data; not using it for unrelated purposes; not for creditworthiness/lending."),
    copy("Privacy policy URL", privacy_url),
]
step("4. Privacy practices", perm_items)

step("5. Distribution", [
    info("Payments", "Free of charge"),
    info("Visibility", "Public"),
    info("Regions", "All regions"),
])

step("6. Account (once)", [
    info("Contact email", "Account tab: set and verify the contact email – publishing is blocked without it."),
])

step("7. Submit", [
    info("Submit for review", "Check that every tab shows no errors, then click “Submit for review”. "
         "Optionally untick “Publish automatically after review” if you want to choose the publication moment yourself."),
])

page = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chrome Web Store – publishing helper</title>
<style>
  :root { --bg:#f6f7f9; --panel:#fff; --text:#16181d; --muted:#667085; --border:#e3e6eb; --accent:#2b59ff; --ok:#16a34a; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161a; --panel:#1c1f25; --text:#e8eaee; --muted:#98a0ad; --border:#2c313a; --accent:#5b7fff; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 28px 16px 80px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .lead { color: var(--muted); margin: 0 0 22px; }
  .step { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; margin-bottom: 14px; }
  .step.done { opacity: .55; }
  .step h2 { font-size: 16px; margin: 0 0 12px; display: flex; align-items: center; gap: 10px; }
  .step h2 input { width: 18px; height: 18px; }
  .item { border-top: 1px solid var(--border); padding: 10px 0; }
  .item:first-of-type { border-top: 0; }
  .label { font-weight: 600; font-size: 13px; display: flex; justify-content: space-between; gap: 12px; align-items: center; }
  .value { color: var(--muted); white-space: pre-wrap; margin-top: 4px; }
  .value.long { max-height: 110px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; }
  button { font: inherit; font-size: 12px; font-weight: 600; border: 1px solid var(--accent); color: #fff; background: var(--accent); border-radius: 7px; padding: 4px 12px; cursor: pointer; white-space: nowrap; }
  button.copied { background: var(--ok); border-color: var(--ok); }
  .files { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
  .file { width: 160px; font-size: 11.5px; color: var(--muted); word-break: break-all; }
  .file img { width: 160px; height: 100px; object-fit: contain; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; display: block; margin-bottom: 4px; }
  .note { margin-top: 10px; font-size: 12.5px; color: var(--muted); }
  code { font: 12px ui-monospace, Menlo, monospace; }
  .tip { background: var(--panel); border: 1px dashed var(--border); border-radius: 12px; padding: 12px 16px; margin-bottom: 18px; font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Chrome Web Store – publishing helper</h1>
  <p class="lead">Intelligent label printing · open <a href="https://chrome.google.com/webstore/devconsole" target="_blank">the developer dashboard</a> in another tab and go through the steps. Ticked steps are remembered in this browser.</p>
  <div class="tip">Tip for file uploads on macOS: in the file dialog press <b>⌘⇧G</b>, paste the folder path (button “Copy folder path”) and press Enter.</div>
  <div id="steps"></div>
</div>
<script>
const STEPS = __STEPS__;
const done = (() => { try { return JSON.parse(localStorage.getItem('cws-done') || '{}'); } catch { return {}; } })();
const save = () => { try { localStorage.setItem('cws-done', JSON.stringify(done)); } catch {} };
const root = document.getElementById('steps');
function copyButton(text, label = 'Copy') {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
    }
    b.classList.add('copied'); b.textContent = 'Copied ✓';
    setTimeout(() => { b.classList.remove('copied'); b.textContent = label; }, 1500);
  };
  return b;
}
STEPS.forEach((s, i) => {
  const box = document.createElement('section');
  box.className = 'step' + (done[i] ? ' done' : '');
  const h = document.createElement('h2');
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!done[i];
  cb.onchange = () => { done[i] = cb.checked; box.classList.toggle('done', cb.checked); save(); };
  h.append(cb, s.title);
  box.append(h);
  for (const it of s.items) {
    const row = document.createElement('div'); row.className = 'item';
    const label = document.createElement('div'); label.className = 'label';
    const span = document.createElement('span'); span.textContent = it.label; label.append(span);
    row.append(label);
    if (it.type === 'copy') {
      label.append(copyButton(it.value));
      const v = document.createElement('div'); v.className = 'value' + (it.value.length > 160 ? ' long' : ''); v.textContent = it.value; row.append(v);
    } else if (it.type === 'info') {
      const v = document.createElement('div'); v.className = 'value'; v.textContent = it.value; row.append(v);
    } else if (it.type === 'files') {
      const folder = it.paths[0].replace(/\\/[^\\/]+$/, '');
      label.append(copyButton(folder, 'Copy folder path'));
      const list = document.createElement('div'); list.className = 'files';
      for (const p of it.paths) {
        const f = document.createElement('div'); f.className = 'file';
        if (/\\.png$/.test(p)) { const im = document.createElement('img'); im.src = 'file://' + p; f.append(im); }
        f.append(p.split('/').pop());
        list.append(f);
      }
      row.append(list);
    }
    box.append(row);
  }
  if (s.note) { const n = document.createElement('div'); n.className = 'note'; n.textContent = s.note; box.append(n); }
  root.append(box);
});
</script>
</body>
</html>
"""
out = os.path.join(HERE, "publish-helper.html")
open(out, "w", encoding="utf-8").write(page.replace("__STEPS__", json.dumps(steps, ensure_ascii=False)))
print(out)
