# Historical S1 Public-Guide Render Evidence

## Status

- Captured: 2026-08-16.
- Classification: historical visual and interaction evidence for the then-current public guide.
- Workflow-copy status: superseded by the `sdd-change-v2` package contract on 2026-08-17.
- Current use: retain only as a responsive, accessibility, and Steel-presentation baseline for S3.
- Product manual acceptance: not established by this record.

This document is not current workflow guidance, a current-source verification result, or a reproduction plan for the retired receipt workflow. Deleted legacy tests and their former claims are intentionally not preserved here.

## Rendered Guide Evidence

The retained artifacts describe the guide that existed on 2026-08-16 at desktop 1440×900 and minimum mobile 320×844:

- `docs/verification/artifacts/s1/reseal-2026-08-16/desktop-guide.png` retains the desktop layout.
- `docs/verification/artifacts/s1/reseal-2026-08-16/mobile-guide-reduced-motion-fallback.png` retains the mobile installation surface after the no-clipboard fallback selected the command text with reduced motion enabled.
- `docs/verification/artifacts/s1/reseal-2026-08-16/desktop-axe.json` and `mobile-axe.json` retain WCAG 2 A/AA axe results for the two viewports.
- `docs/verification/artifacts/s1/reseal-2026-08-16/desktop-browser-checks.json` and `mobile-browser-checks.json` retain computed foreground/background, viewport, overflow, reduced-motion, and control-size observations.
- `docs/verification/artifacts/s1/reseal-2026-08-16/SHA256SUMS` binds the images and retained browser results.
- Both viewports had zero page-level horizontal overflow and zero browser console errors.
- Isolated browser sessions reported zero axe violations at both viewports; each retained result had one incomplete color-contrast analysis rather than a violation.
- At 320×844, Tab exposed the skip link first and Enter focused `main#main-content`.
- Reduced-motion emulation matched, the command fallback announced `Selected`, and the copy control plus both mobile navigation links measured 44 CSS pixels high.
- Focusable named regions kept horizontally scrollable filesystem examples keyboard reachable.

These observations do not prove that the current v2 workflow copy renders correctly. S3 owns fresh current-source desktop/mobile rendering, accessibility verification, reduced-motion checks, and owner acceptance.

## Artifact Integrity

Verify the retained historical files from the package root with:

```sh
cd docs/verification/artifacts/s1/reseal-2026-08-16
shasum -a 256 -c SHA256SUMS
```
