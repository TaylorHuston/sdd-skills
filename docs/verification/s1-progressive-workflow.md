# S1 Progressive-Workflow Verification

## Status

- Scope: integrated progressive SDD workflow package candidate and current-source public guide.
- Date: 2026-08-16.
- Product manual acceptance: pending owner confirmation of the desktop/mobile guide.
- Technical result: deterministic and rendered checks pass; no accepted technical gaps.

## Deterministic Verification

Run from the package root:

```sh
npm test
npm run lint --if-present
npm run typecheck --if-present
node ./bin/sdd.js --help
node ./bin/sdd.js validate sdd-skills --change 2026-08-12-simplify-sdd-apply --workspace /Users/taylor/src/my-life --json
```

Focused coverage includes `test/change-tasks.test.js`, `test/slice-review.test.js`, `test/slice-closure.test.js`, `test/change-contract.test.js`, `test/workflow-contracts.test.js`, `test/cli.test.js`, and `test/site.test.js`. The package intentionally retains the separately documented historical package-race constraint if it reproduces in an aggregate run; it is not evidence for or against the progressive-workflow contract.

## Rendered Guide Evidence

Serve `site/` as static files and inspect the current-source guide at desktop 1440×900 and minimum mobile 320×844.

- `docs/verification/artifacts/s1/reseal-2026-08-16/desktop-guide.png` shows the current reference-implementation section at 1440×900.
- `docs/verification/artifacts/s1/reseal-2026-08-16/mobile-guide-reduced-motion-fallback.png` shows the 320×844 installation surface after the no-clipboard fallback selected the command text with reduced motion enabled.
- `docs/verification/artifacts/s1/reseal-2026-08-16/desktop-axe.json` and `mobile-axe.json` retain fresh-session WCAG 2 A/AA axe results for the two viewports.
- `docs/verification/artifacts/s1/reseal-2026-08-16/desktop-browser-checks.json` and `mobile-browser-checks.json` retain computed foreground/background, viewport, overflow, reduced-motion, and control-size observations.
- `docs/verification/artifacts/s1/reseal-2026-08-16/SHA256SUMS` binds the images and retained browser results.
- Both viewports had zero page-level horizontal overflow and zero browser console errors.
- Fresh isolated browser sessions reported zero axe violations at both viewports; each retained result has one incomplete color-contrast analysis rather than a violation. Keep desktop and mobile media emulation in separate sessions so reused emulation state cannot corrupt computed-color observations.
- At 320×844, Tab exposed the skip link first and Enter focused `main#main-content`.
- Reduced-motion media emulation matched, the command fallback announced `Selected` and selected text containing `sdd setup`, and the copy control plus both mobile navigation links measured 44 CSS pixels high.
- Focusable named regions now own horizontally scrollable filesystem examples, so keyboard users can reach them.

## Reproduction

1. Run `python3 -m http.server 4173 --directory site` from the package root.
2. Open `http://127.0.0.1:4173/#implementation` at 1440×900 and 320×844.
3. Confirm the workspace-owned Change layout, one-Requirement slice language, detailed Review/minimal receipt boundary, current-only setup wording, and no page-level overflow.
4. At mobile width, enable reduced motion, Tab to the skip link, activate it, and confirm focus moves to `main#main-content`.
5. Make the Clipboard API unavailable, activate **Copy**, and confirm the button announces **Selected** while the command text is selected.
6. In separate fresh browser sessions, run an axe WCAG 2 A/AA audit and inspect computed body colors, overflow, and console errors at both viewports. Use only supported media arguments; do not reuse a session whose media emulation is unknown.
7. From the package root, verify retained evidence with `cd docs/verification/artifacts/s1/reseal-2026-08-16 && shasum -a 256 -c SHA256SUMS`.

## Acceptance Record

Technical rendered verification passed on 2026-08-16. Owner manual confirmation of the current guide remains pending and does not substitute for the technical evidence above.
