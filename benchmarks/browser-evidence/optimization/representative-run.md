# Recorded medium failure, run 1

Actual terminal MCP interactions from the production-metadata ten-pair experiment. Browser screenshots/trace bytes were not returned; Ratatoskr returned only a screenshot ID. Local ports differ because sessions are isolated. Text content below is native text, not an additional serialized wrapper.

## baseline

### 1. browser_navigate

Arguments:

```json
{
  "url": "http://127.0.0.1:39352/profile"
}
```

Native text content:

````text
### Ran Playwright code
```js
await page.goto('http://127.0.0.1:39352/profile');
```
### Page
- Page URL: http://127.0.0.1:39352/profile
- Page Title: Profile Settings
### Snapshot
- [Snapshot](./page-2026-10-02T21-18-42-672Z.yml)
````

### 2. browser_fill_form

Arguments:

```json
{
  "fields": [
    {
      "name": "Name",
      "target": "#name",
      "type": "textbox",
      "value": "Ratatoskr Test"
    },
    {
      "name": "Email",
      "target": "#field-1",
      "type": "textbox",
      "value": "ratatoskr@example.test"
    },
    {
      "name": "Company",
      "target": "#field-2",
      "type": "textbox",
      "value": "Acme Labs"
    },
    {
      "name": "Job title",
      "target": "#field-3",
      "type": "textbox",
      "value": "Engineer"
    }
  ]
}
```

Native text content:

````text
### Ran Playwright code
```js
await page.locator('#name').fill('Ratatoskr Test');
await page.locator('#field-1').fill('ratatoskr@example.test');
await page.locator('#field-2').fill('Acme Labs');
await page.locator('#field-3').fill('Engineer');
```
````

### 3. browser_click

Arguments:

```json
{
  "target": "button:has-text(\"Save\")"
}
```

Native text content:

````text
### Ran Playwright code
```js
await page.locator('button:has-text("Save")').click();
```
### Page
- Page URL: http://127.0.0.1:39352/profile
- Page Title: Profile Settings
- Console: 2 errors, 0 warnings
### Snapshot
- [Snapshot](./page-2026-10-02T21-18-51-383Z.yml)
### Events
- New console entries: console-2026-10-02T21-18-42-549Z.log#L1-L2
````

### 4. browser_wait_for

Arguments:

```json
{
  "text": "Ratatoskr Test"
}
```

Native text content:

```text
### Error
TimeoutError: Timeout 5000ms exceeded.
Call log:
[2m  - waiting for getByText('Ratatoskr Test').first() to be visible[22m

```

### 5. browser_snapshot

Arguments:

```json
{
  "target": "[data-testid=\"persisted-name\"]"
}
```

Native text content:

````text
### Page
- Page URL: http://127.0.0.1:39352/profile
- Page Title: Profile Settings
- Console: 2 errors, 0 warnings
### Snapshot
```yaml
- text: Jane Developer
```
````

### 6. browser_network_requests

Arguments:

```json
{
  "static": false,
  "filter": "/api/"
}
```

Native text content:

```text
### Result
2. [POST] http://127.0.0.1:39352/api/profile => [500] Internal Server Error

Note: 1 static request not shown, run with "static" option to see it.
```

### 7. browser_console_messages

Arguments:

```json
{
  "level": "error"
}
```

Native text content:

```text
### Result
Total messages: 2 (Errors: 2, Warnings: 0)

[ERROR] Failed to load resource: the server responded with a status of 500 (Internal Server Error) @ http://127.0.0.1:39352/api/profile:0
[ERROR] Failed to save profile: INTERNAL_ERROR @ http://127.0.0.1:39352/profile:9
```

## ratatoskr

### 1. run_browser_workflow

Arguments:

```json
{
  "url": "http://127.0.0.1:37932/profile",
  "steps": [
    {
      "do": "fill",
      "css": "#name",
      "valueRef": "BENCHMARK_NAME"
    },
    {
      "do": "fill",
      "css": "#field-1",
      "valueRef": "BENCHMARK_FIELD_1"
    },
    {
      "do": "fill",
      "css": "#field-2",
      "valueRef": "BENCHMARK_FIELD_2"
    },
    {
      "do": "fill",
      "css": "#field-3",
      "valueRef": "BENCHMARK_FIELD_3"
    },
    {
      "do": "click",
      "role": "button",
      "name": "Save"
    },
    {
      "do": "has",
      "testId": "persisted-name",
      "text": "Ratatoskr Test"
    },
    {
      "do": "navigate",
      "url": "http://127.0.0.1:37932/profile"
    },
    {
      "do": "has",
      "testId": "persisted-name",
      "text": "Ratatoskr Test"
    },
    {
      "do": "has",
      "testId": "persisted-field-1",
      "text": "ratatoskr@example.test"
    },
    {
      "do": "has",
      "testId": "persisted-field-2",
      "text": "Acme Labs"
    },
    {
      "do": "has",
      "testId": "persisted-field-3",
      "text": "Engineer"
    }
  ]
}
```

Native text content:

```text
Workflow failed at step 5: Expected text to contain Ratatoskr Test
```

Native structured content:

```json
{
  "success": false,
  "runId": "run_76d0203cff97490a950ab7d3dfe01904",
  "failedStep": 5,
  "action": "assert_text",
  "reason": "Expected text to contain Ratatoskr Test",
  "actualUrl": "http://127.0.0.1:37932/profile",
  "relevantErrors": [
    {
      "type": "http",
      "method": "POST",
      "path": "/api/profile",
      "status": 500
    },
    {
      "type": "console",
      "message": "Failed to save profile: INTERNAL_ERROR"
    }
  ],
  "actualText": "Jane Developer",
  "artifacts": {
    "screenshot": "artifact_a9645e6bdb164d539c6e750cd4cae25a"
  }
}
```
