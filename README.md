# web-agent-tester

Autonomous agentic AI web app tester powered by **Claude + Playwright**.

No predefined test scripts. Claude sees the page, decides what to do, fills forms, clicks around, and records assertions — all from plain English goals.

## How it works

1. You define a target: a URL + a list of plain-English test goals
2. The agent navigates the app, takes screenshots, interacts with it
3. Claude decides what to do next using tool use (navigate, click, fill, assert, done)
4. Results + a JSON report are saved to `reports/`

## Setup

```bash
cp .env.example .env
# Add your Anthropic API key to .env

npm install
```

## Run

```bash
# Test FinWiser
npm run run:finwiser

# Test any target
npm run run <target-name>
# where target-name matches a file in targets/
```

## Add a new target

Create `targets/myapp.ts`:

```typescript
export default {
  name: 'My App',
  baseUrl: 'https://myapp.com',
  goals: [
    'Verify the homepage loads and the hero text is visible',
    'Navigate to the login page and verify the form has email and password fields',
    'Test the signup flow with a valid email and password',
  ],
}
```

Then run:
```bash
npm run run myapp
```

## Reports

JSON reports are saved to `reports/<target>-<timestamp>.json` after each run with full assertion details.

## Architecture

```
src/
  tools.ts   — Playwright actions Claude can call (navigate, click, fill, screenshot, assert, done)
  agent.ts   — Claude agent loop (tool use, conversation history, max iterations)
  runner.ts  — Entry point: loads target, runs goals sequentially, prints + saves report
targets/
  finwiser.ts — FinWiser test goals
  *.ts        — Add your own
```
