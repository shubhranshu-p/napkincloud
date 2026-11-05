# Development

Use Node.js 24 or newer. No application dependencies need installing.

```sh
npm start
npm run check
npm test
npm run build
```

Tests use local fixtures and mock provider calls; they do not require a Meta key. Keep changes focused and add regression tests for routing, protected assumptions, result provenance, cancellation, or credential boundaries. Verify interface changes in desktop and mobile browsers and respect reduced motion. Never replace a failing result with invented passing metrics.
