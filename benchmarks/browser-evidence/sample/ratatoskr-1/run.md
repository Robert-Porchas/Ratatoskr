# ratatoskr run 1 (replay)

Task: Open the profile page, change the name to 'Ratatoskr Test', save it, and verify that the change persisted. If it fails, determine the cause and report the relevant evidence.

1. run_browser_workflow (931 ms; 551 text bytes)

```json
{"startUrl":"http://127.0.0.1:38078/profile","timeoutMs":15000,"steps":[{"action":"fill","target":{"kind":"label","label":"Name"},"valueRef":"BENCHMARK_NAME"},{"action":"click","target":{"kind":"role","role":"button","name":"Save"}},{"action":"assert_text","target":{"kind":"testId","testId":"persisted-name"},"contains":"Ratatoskr Test","timeoutMs":500}]}
{"content":[{"type":"text","text":"Workflow failed at step 2: Expected text to contain Ratatoskr Test"}],"structuredContent":{"success":false,"runId":"run_646463a3853b4e39ae0bdab367c211df","failedStep":2,"action":"assert_text","reason":"Expected text to contain Ratatoskr Test","actualUrl":"http://127.0.0.1:38078/profile","relevantErrors":[{"type":"http","method":"POST","path":"/api/profile","status":500},{"type":"console","message":"Failed to save profile: INTERNAL_ERROR"}],"artifacts":{"screenshot":"artifact_d8bf37689cb44248b554422b92b0834a"}}}
```

Diagnosis: {"persisted":false,"method":"POST","path":"/api/profile","status":500,"errorCode":"INTERNAL_ERROR","evidence":["{\"method\":\"POST\",\"path\":\"/api/profile\",\"status\":500}","Failed to save profile: INTERNAL_ERROR"]}

Criteria: {"openedCorrectPage":true,"changedName":true,"attemptedSave":true,"recognizedPersistenceFailure":true,"identifiedHttp500":true,"identifiedInternalError":true,"didNotClaimPersistence":true}
