# baseline run 1 (replay)

Task: Open the profile page, change the name to 'Ratatoskr Test', save it, and verify that the change persisted. If it fails, determine the cause and report the relevant evidence.

1. browser_navigate (90 ms; 400 text bytes)

```json
{"url":"http://127.0.0.1:39606/profile"}
{"url":"http://127.0.0.1:39606/profile","accessibility":"- heading \"Profile Settings\" [level=1]\n- text: Name\n- textbox \"Name\": Jane Developer\n- text: Email\n- textbox \"Email\": jane@example.test\n- button \"Save\"\n- status: No changes saved.\n- paragraph: \"Persisted name: Jane Developer\"","controls":[{"name":"name","value":"Jane Developer"},{"name":"email","value":"jane@example.test"}]}
```

2. browser_fill (31 ms; 400 text bytes)

```json
{"target":{"kind":"label","label":"Name"},"value":"Ratatoskr Test"}
{"url":"http://127.0.0.1:39606/profile","accessibility":"- heading \"Profile Settings\" [level=1]\n- text: Name\n- textbox \"Name\": Ratatoskr Test\n- text: Email\n- textbox \"Email\": jane@example.test\n- button \"Save\"\n- status: No changes saved.\n- paragraph: \"Persisted name: Jane Developer\"","controls":[{"name":"name","value":"Ratatoskr Test"},{"name":"email","value":"jane@example.test"}]}
```

3. browser_click (68 ms; 406 text bytes)

```json
{"target":{"kind":"role","role":"button","name":"Save"}}
{"url":"http://127.0.0.1:39606/profile","accessibility":"- heading \"Profile Settings\" [level=1]\n- text: Name\n- textbox \"Name\": Ratatoskr Test\n- text: Email\n- textbox \"Email\": jane@example.test\n- button \"Save\"\n- status: Unable to save profile.\n- paragraph: \"Persisted name: Jane Developer\"","controls":[{"name":"name","value":"Ratatoskr Test"},{"name":"email","value":"jane@example.test"}]}
```

4. browser_network (0 ms; 3143 text bytes)

```json
{}
[{"type":"request","at":1790888147280,"method":"GET","path":"/profile","headers":{"upgrade-insecure-requests":"1","user-agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36","sec-ch-ua":"\"HeadlessChrome\";v=\"153\", \"Not_A Brand\";v=\"8\", \"Chromium\";v=\"153\"","sec-ch-ua-mobile":"?0","sec-ch-ua-platform":"\"Linux\""},"body":null},{"type":"response","at":1790888147290,"method":"GET","path":"/profile","status":200,"headers":{"cache-control":"no-store","connection":"keep-alive","content-type":"text/html; charset=utf-8","date":"Thu, 01 Oct 2026 20:55:47 GMT","keep-alive":"timeout=5","transfer-encoding":"chunked"},"body":"<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Profile Settings</title><link rel=\"icon\" href=\"data:,\"></head><body>\n<h1>Profile Settings</h1>\n<form id=\"profile\">\n<label for=\"name\">Name</label><input id=\"name\" name=\"name\" value=\"Jane Developer\">\n<label for=\"email\">Email</label><input id=\"email\" name=\"email\" type=\"email\" value=\"jane@example.test\">\n<button type=\"submit\">Save</button>\n</form>\n<p role=\"status\" id=\"status\">No changes saved.</p>\n<p>Persisted name: <span data-testid=\"persisted-name\">Jane Developer</span></p>\n<script>\ndocument.querySelector('#profile').addEventListener('submit', async event => {\n  event.preventDefault();\n  const status = document.querySelector('#status');\n  status.textContent = 'Saving…';\n  try {\n    const response = await fetch('/api/profile', {\n      method: 'POST', headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({ name: document.querySelector('#name').value, email: document.querySelector('#email').value })\n    });\n    const result = await response.json();\n    if (!response.ok) {\n      console.error('Failed to save profile: ' + result.error);\n      status.textContent = 'Unable to save profile.';\n      return;\n    }\n    document.querySelector('[data-testid=\"persisted-name\"]').textContent = result.name;\n    status.textContent = 'Profile saved.';\n  } catch {\n    console.error('Profile request could not complete');\n    status.textContent = 'Unable to save profile.';\n  }\n});\n</script></body></html>"},{"type":"request","at":1790888147431,"method":"POST","path":"/api/profile","headers":{"sec-ch-ua-platform":"\"Linux\"","referer":"http://127.0.0.1:39606/profile","user-agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36","sec-ch-ua":"\"HeadlessChrome\";v=\"153\", \"Not_A Brand\";v=\"8\", \"Chromium\";v=\"153\"","content-type":"application/json","sec-ch-ua-mobile":"?0"},"body":"{\"name\":\"Ratatoskr Test\",\"email\":\"jane@example.test\"}"},{"type":"response","at":1790888147438,"method":"POST","path":"/api/profile","status":500,"headers":{"transfer-encoding":"chunked","cache-control":"no-store","keep-alive":"timeout=5","date":"Thu, 01 Oct 2026 20:55:47 GMT","content-type":"application/json","connection":"keep-alive"},"body":"{\"error\":\"INTERNAL_ERROR\",\"message\":\"Unable to persist profile\"}"}]
```

5. browser_console (0 ms; 263 text bytes)

```json
{}
[{"type":"console","at":1790888147439,"level":"error","message":"Failed to load resource: the server responded with a status of 500 (Internal Server Error)"},{"type":"console","at":1790888147442,"level":"error","message":"Failed to save profile: INTERNAL_ERROR"}]
```

6. browser_navigate (58 ms; 400 text bytes)

```json
{"url":"http://127.0.0.1:39606/profile"}
{"url":"http://127.0.0.1:39606/profile","accessibility":"- heading \"Profile Settings\" [level=1]\n- text: Name\n- textbox \"Name\": Jane Developer\n- text: Email\n- textbox \"Email\": jane@example.test\n- button \"Save\"\n- status: No changes saved.\n- paragraph: \"Persisted name: Jane Developer\"","controls":[{"name":"name","value":"Jane Developer"},{"name":"email","value":"jane@example.test"}]}
```

Diagnosis: {"persisted":false,"method":"POST","path":"/api/profile","status":500,"errorCode":"INTERNAL_ERROR","evidence":["{\"method\":\"POST\",\"path\":\"/api/profile\",\"status\":500}","Failed to save profile: INTERNAL_ERROR"]}

Criteria: {"openedCorrectPage":true,"changedName":true,"attemptedSave":true,"recognizedPersistenceFailure":true,"identifiedHttp500":true,"identifiedInternalError":true,"didNotClaimPersistence":true}
