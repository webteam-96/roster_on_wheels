# UI label review sheets (one per language)

For native-speaker reviewers. Each `<lang>.csv` (fr, de, it, ja, ko, pt, es) opens in Excel and lists every one of the
4,594 interface labels: the English text, the current translation, automatic flags, and two empty columns.

**What to do:** read each row. If the translation is wrong, unnatural or not the term Rotary uses in your language,
write the correct text in **Corrected** (leave it empty when the translation is fine). Use **Comment** for anything
else. Rows with flags come first; start there, then read the rest.

**Flags** (hints from an automatic check, not errors):

| Flag | Meaning |
|---|---|
| `same` | Same as the English. Fine for names and codes; otherwise probably untranslated. |
| `long` | Much longer than the English on a short label: may not fit a button or menu. Shorten if you can. |
| `edges` | End punctuation (`.` `:` `?`) or a leading / trailing space differs from the English. |
| `term:X=Y` | The label contains the term X, which is usually translated Y, but Y is not in this translation. Often fine (e.g. "Board Member" is not "Member"); check that the Rotary term is right and used the same way everywhere. |
| `placeholder` | A `{name}` or `%s` placeholder is missing or different. Must match the English exactly. |
| `script` | Japanese / Korean text with no Japanese / Korean characters. |

Sheets are regenerated with `python -I row/database/translations/review.py` (it overwrites them; copy your edits out
first). Corrections go back into `ui-labels-*.json`, then `build_sql.py` builds the database script.
