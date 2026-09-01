# S3 Risk-Triggered Guide Verification

## Status

- Captured: 2026-08-18.
- Technical result: pass.
- Manual product acceptance: user confirmed 2026-08-18.
- Baseline commit: `8c33da8f4f4f173c3dbee240bf8e6fa15b026d05`.
- Rendered source SHA-256:
  - `site/index.html`: `5cc0ea7fa6da1ebadfe27abc824930d6f14fd8128ac43d73ace3ea4f777921cf`
  - `site/site.js`: `5bb9eff24e166a5b656dfaed74ee6172d8a839dd1d13f6d73ab3ef2ce93dd443`
  - `site/styles.css`: `9376a18c12fa0b9f4d66f681163e2453a49ef66403c4a4ad56fb09a3ff416d39`

Central `review.md` owns the exact repository candidate that includes this descriptor and the Epic reconciliation. The source hashes above bind the rendered surface without making this document self-referential.

## Reproduction

From the package root:

```sh
python3 -m http.server 4173 --directory site
```

Open `http://127.0.0.1:4173/` in isolated Chromium sessions. Use a 1440×900 desktop viewport and a 320×844 mobile viewport. On mobile, emulate `prefers-reduced-motion: reduce`. Audit WCAG 2 A/AA and inspect browser console and page errors.

For the clipboard fallback, replace `navigator.clipboard` with `undefined` in the isolated local page, activate `#copy-command`, and inspect both the control label and selected text. For keyboard bypass, reload, press Tab once, activate the skip link, and inspect `document.activeElement`.

## Scenario Observations

### SDD-E001/S7 R2-S1 — Narrow Viewport Navigation

- Desktop and 320px mobile document widths equaled their viewport widths; neither had page-level horizontal overflow.
- The mobile `Method` and `Implementation` controls remained reachable and measured 44 CSS pixels high.
- Activating `Implementation` scrolled to the reference implementation and updated both mobile and desktop current-location navigation.
- Long filesystem examples remained contained within their keyboard-focusable regions.
- Direct screenshot inspection found no collisions, clipping outside contained code surfaces, or broken hierarchy.

### SDD-E001/S7 R3-S1 — Clipboard Failure

- Tab exposed the visible `Skip to content` link first; activation moved focus to `main#main-content`.
- With `navigator.clipboard` unavailable, activating the copy control selected the complete 227-character command block and announced `Selected` through the existing live label.
- Copy and mobile navigation controls measured 44 CSS pixels high.

### SDD-E001/S7 R4-S1 — Reduced Motion

- Mobile emulation matched `prefers-reduced-motion: reduce`.
- Computed root scrolling was `auto` and the copy control transition duration was `0.00001s`.
- Navigation current-state feedback remained visible and functional.
- The guide retained the Steel foreground `rgb(244, 244, 245)` on background `rgb(9, 9, 11)`.

### SDD-E001/S7 R5-S2 — Risk-Triggered Default

- The public Change layout shows exactly `change.md`, `tasks.md`, and `review.md` as current records.
- The guide explains coherent outcomes, five universal gates, concrete behavior-derived triggers, focused verification, exact-candidate independent Review, one bounded remediation cycle, explicit dated technical gaps, separate product acceptance, conditional Epic reconciliation, selective content-identical local commit authority, and the stop before remote delivery.
- Schema-less and receipt-based records are classified as unsupported pre-1.0 history, not advertised as a migration path or second current profile.
- Focused source-contract tests reject retired Review/receipt/ledger wording from the current guide.

## Accessibility And Runtime Results

- Chromium axe-core 4.12.1 reported zero WCAG 2 A/AA violations at both viewports.
- Axe retained one incomplete color-contrast analysis per viewport where layered/partially obscured content or non-text arrows prevented automatic determination. The shared Steel colors and screenshots were inspected directly; no changed element introduced a new palette or contrast treatment.
- Browser console messages: zero at both viewports.
- Browser page errors: zero at both viewports.

## Durable Artifacts

All files below live under `docs/verification/artifacts/s3/2026-08-18/` and are checksum-bound by `SHA256SUMS`:

- `desktop-guide.png` — full-page desktop render.
- `desktop-current-workflow.png` — desktop current-workflow surface.
- `mobile-guide-reduced-motion.png` — minimum-width current-workflow surface with reduced motion.
- `desktop-browser-checks.json`, `mobile-browser-checks.json` — viewport, overflow, navigation, control-size, motion, and color observations.
- `desktop-interactions.json` — skip-link and clipboard-fallback observations.
- `desktop-axe.json`, `mobile-axe.json` — accessibility results.
- `desktop-console.json`, `mobile-console.json` — console results.
- `desktop-errors.json`, `mobile-errors.json` — page-error results.
