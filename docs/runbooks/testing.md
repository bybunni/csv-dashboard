# Testing Runbook

## Purpose

Run the project regression suite locally and in CI-compatible mode.

## Prerequisites

- Node.js 22
- npm
- Project dependencies installed

## Setup

```bash
cd /Users/bunni/workspace/csv-dashboard
npm install
npx playwright install --with-deps chromium
```

## Commands

Run full regression suite:

```bash
npm test
```

Run only unit tests:

```bash
npm run test:unit
```

Run unit tests with coverage thresholds:

```bash
npm run test:coverage
```

Run only end-to-end tests:

```bash
npm run test:e2e
```

Run headed browser e2e tests:

```bash
npm run test:e2e:headed
```

## Expected Results

- Unit tests pass with Vitest.
- E2E tests pass with Playwright against the local web server started by Playwright config.
