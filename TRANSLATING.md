# Translating Intelligent label printing

Thank you for helping! A translation is one folder with one file, plus an optional user guide. You don't need to know JavaScript.

## Add a new language

1. **Fork** the repository and create a branch.
2. **Copy** `extension/_locales/en/` to `extension/_locales/<code>/`. Use [Chrome's locale code](https://developer.chrome.com/docs/extensions/reference/api/i18n#locales), e.g. `de`, `fr`, `es`, `pt_BR` (with an underscore).
3. **Translate** every `"message"` in `extension/_locales/<code>/messages.json`. The `"description"` fields explain where each text appears. You can delete them in your copy; English keeps them.
4. **Register** the language in `extension/languages.json`:
   ```json
   "de": { "name": "Deutsch", "guide": false }
   ```
   `name` is the language's own name, as it should appear in the language menu.
5. **Optional, translate the user guide:** copy `docs/guide/en.md` to `docs/guide/<code>.md`, translate it, add your language to the links at the top of every guide, and set `"guide": true` in `languages.json`. The extension's **Help** link then opens your guide.
6. **Check** your work: `node scripts/check-i18n.mjs` (Node.js 18+). The same check runs automatically on your Pull Request.
7. **Open a Pull Request.**

## Rules for texts

- **Keep `{placeholders}` exactly as they are**, e.g. `{printer}`, `{n}`. You can move them within the sentence.
- **Keep HTML tags** (`<b>`, `<br>`, `<code>`, `<li>` …) and their order of meaning. Translate only the text between them.
- **Don't use `$`.** Chrome reads `$…$` as a placeholder of its own.
- **Leading or trailing spaces matter** in a few texts (e.g. `copySuffix`, `rasterMode`). Keep them.
- `extDescription` is the short description in the Chrome Web Store: **max 132 characters**.
- `extName` is the product name. It is usually not translated.

## Plural forms

Texts that depend on a number come in plural forms, e.g. `labels_one` ("{n} label") and `labels_other` ("{n} labels"). Add the forms your language needs using the [Unicode plural categories](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html): `_zero`, `_one`, `_two`, `_few`, `_many`, `_other`. Always include `_other`.

Example (Polish needs three forms):

```json
"labels_one":   { "message": "{n} etykietę" },
"labels_few":   { "message": "{n} etykiety" },
"labels_many":  { "message": "{n} etykiet" },
"labels_other": { "message": "{n} etykiety" }
```

## Updating a translation

When new features add texts, they first appear in English in every language. The check on each Pull Request lists the texts still missing per language. Translate the ones listed for your language and open a Pull Request.

## Testing your translation

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the `extension` folder.
2. Open the extension's settings and choose your language in the **Language** menu.
3. Check the popup, the settings and the preview page for texts that are too long or cut off.
