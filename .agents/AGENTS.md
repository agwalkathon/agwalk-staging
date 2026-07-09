## CSS Filter: Selective Black-to-White Inversion (Preserve Brand Colors)

When a user wants to flip **black to white and white to black** on an image or element
WITHOUT changing other colors (e.g., orange, red, blue brand colors), use:

```css
filter: invert(1) hue-rotate(180deg);
```

**Why this works:**
- `invert(1)` flips all pixel values; achromatic pixels (black/white) flip correctly but
  coloured pixels shift to their complementary hue.
- `hue-rotate(180deg)` cancels the hue shift for coloured pixels, restoring them to
  their original hue while leaving the achromatic inversion intact.

**Do NOT use these for this purpose:**
- `filter: invert(1)` — inverts all colors, orange → blue-cyan ❌
- `filter: brightness(0) invert(1)` — forces everything to white/black, destroys colors ❌

---

## JS Cache Busting — Always Bump Version in app.html

The agwalk project loads all JS modules with explicit version query strings in `app.html`:

```html
<script src="app-dashboard.js?v=20260708_v147" defer></script>
```

**Rule:** Whenever you edit and deploy ANY of these JS files, you MUST ALSO update the
corresponding `?v=YYYYMMDD_vNNN` string in `app.html` (incrementing the version number),
then deploy `app.html` too. Failing to do this means users' browsers serve the old cached
file and changes do not appear.

Files that follow this pattern:
- `app-config.js`
- `app-employee.js`
- `app-api.js`
- `app-drawers.js`
- `app-events.js`
- `app-dashboard.js`
- `app-tabs.js`
- `app.css`
