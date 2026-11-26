# Phase 1 design review

Open `/styleguide` after signing in. All component examples are synthetic. The Home screen retains its existing content until Phase 3; the shell and shared components are the scope of this review.

- [Desktop styleguide](phase-1-styleguide-1440.png)
- [Phone styleguide](phase-1-styleguide-390.png)
- [Phone dark theme](phase-1-styleguide-dark-390.png)

- Home shell: [desktop](phase-1-home-shell-1440.png), [phone](phase-1-home-shell-390.png)
- Coaching placeholder: [desktop](phase-1-coaching-1440.png), [phone](phase-1-coaching-390.png)
- Quality placeholder: [desktop](phase-1-quality-1440.png), [phone](phase-1-quality-390.png)
- Queues placeholder: [desktop](phase-1-queues-1440.png), [phone](phase-1-queues-390.png)
- Reports placeholder: [desktop](phase-1-reports-1440.png), [phone](phase-1-reports-390.png)

**Validation:** 181 unit tests passed, one existing skip; all five Playwright specs passed. Lint, typecheck and the isolated production build pass.

The reference and `plan-v2.md` are preserved byte for byte. Fonts are bundled locally with Fontsource; there are no runtime font requests to Google.

Small labels use the muted token instead of faint, and SOON tags use a darker warning text token, to meet 4.5:1 contrast. The original decorative colors remain available. Keyboard users can open search with Ctrl/Cmd K, Tab through results, and close dialogs with Escape; focus returns to the trigger. Reduced motion disables the urgent pulse. Loading placeholders do not animate.

The eight destinations are in the shell. Attendance currently opens the existing discrepancy review; its grid is Phase 4. Coaching, Quality, Queues and Reports show explicit empty states until their phases. Search includes the retained Trends and discrepancy screens. Log coaching and Copy EOD open their destination placeholders until the relevant phase. Sidebar counts are synthetic examples on the styleguide only; live counts await the Phase 2 flags and coaching data.

The UI requests `scope=mine`; covered-team support remains in the server model and explicit regression fixtures. The greeting uses `me.firstName` from private config, and the existing cycle utility supplies the Cairo date and cycle position. The supplied queue source is saved only in ignored local config; Phase 1 does not read it. QA is not connected.

## Reproduce the checks

```sh
npm run lint
npm run typecheck
npm test -- --maxWorkers=1
npm run smoke -- --workers=1
```

Playwright builds the server into `server/dist.test` and the frontend into `web/dist`, then runs with in-memory fixture databases on ports 3210 and 3211. This keeps review builds out of the installed Windows release even when `server/dist` is a deployment junction. The build checks, browser flows, screenshots, local font requests, keyboard controls, contrast and page overflow are verified without live source access. Layout checks cover 1440, 1280, 1024, 768 and 390px.

**Checkpoint:** Phase 2 is stopped pending the owner's design review. No PR is merged and no deployment is requested.
