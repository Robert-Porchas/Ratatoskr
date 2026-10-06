# Session diagnostic token comparison

Codex-reported turn.completed.usage from fresh isolated tasks. Total=input+output; cache and reasoning are subsets. No byte-to-token conversion. All failures remain in statistics. Model: gpt-6.1-sol; Codex: codex-cli 0.160.1; browser: 153.0.8010.12; commit: 8ad70e67d26c7c265e2cfb78ec4a19263312eafd; started: 2026-10-06T06:18:44.225Z.

| Scenario | Case | Runs | Median tokens | Min–max | Mean ± SD | Median calls | Inspect calls | Invalid | Success | Diagnosis |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| success | with | 1 | 31,499 | 31,499–31,499 | 31,499 ± 0 | 1 | 0 | 0 | 1/1 | 1/1 |
| success | without | 1 | 31,466 | 31,466–31,466 | 31,466 ± 0 | 1 | 0 | 0 | 1/1 | 1/1 |
| missing | with | 1 | 43,184 | 43,184–43,184 | 43,184 ± 0 | 2 | 1 | 0 | 1/1 | 1/1 |
| missing | without | 1 | 43,592 | 43,592–43,592 | 43,592 ± 0 | 2 | 1 | 0 | 0/1 | 0/1 |
| scope | with | 1 | 43,337 | 43,337–43,337 | 43,337 ± 0 | 2 | 1 | 0 | 1/1 | 1/1 |
| scope | without | 1 | 43,227 | 43,227–43,227 | 43,227 ± 0 | 2 | 1 | 0 | 1/1 | 1/1 |
| loss | with | 1 | 43,791 | 43,791–43,791 | 43,791 ± 0 | 2 | 1 | 0 | 1/1 | 1/1 |
| loss | without | 1 | 43,812 | 43,812–43,812 | 43,812 ± 0 | 2 | 1 | 0 | 1/1 | 1/1 |
| unrelated | with | 1 | 43,299 | 43,299–43,299 | 43,299 ± 0 | 2 | 1 | 0 | 1/1 | 1/1 |
| unrelated | without | 1 | 43,234 | 43,234–43,234 | 43,234 ± 0 | 2 | 1 | 0 | 1/1 | 1/1 |

success: with versus without: -0.1% total-token reduction. Diagnostic correctness must be comparable.

missing: with versus without: 0.9% total-token reduction. Diagnostic correctness must be comparable.

scope: with versus without: -0.3% total-token reduction. Diagnostic correctness must be comparable.

loss: with versus without: 0% total-token reduction. Diagnostic correctness must be comparable.

unrelated: with versus without: -0.2% total-token reduction. Diagnostic correctness must be comparable.

## Supporting medians (bytes are not tokens)

| Scenario / case | Input / cached / uncached / output / reasoning tokens | Evidence bytes | Session L1 / L2 bytes | Capture / diff ms | Local session bytes | Schema bytes | Args bytes | Workflow ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| success/with | 31,115 / 25,984 / 5,131 / 384 / 70 | 116 | 0 / 0 | 79.4 / 1 | 2,233 | 4,144 | 498 | 569 |
| missing/with | 42,750 / 38,528 / 4,222 / 434 / 43 | 2,152 | 129 / 1,133 | 90.3 / 0.7 | 1,894 | 4,144 | 586 | 5,641 |
| success/without | 31,075 / 27,776 / 3,299 / 391 / 81 | 116 | 0 / 0 | 75.9 / 1 | 2,233 | 4,144 | 498 | 550 |
| missing/without | 43,128 / 38,528 / 4,600 / 464 / 59 | 3,483 | 0 / 1,133 | 83.8 / 0.8 | 1,894 | 4,144 | 594 | 5,654 |
| scope/with | 42,920 / 38,528 / 4,392 / 417 / 0 | 2,514 | 134 / 1,490 | 90.9 / 1.2 | 2,807 | 4,144 | 584 | 5,631 |
| loss/with | 43,366 / 38,528 / 4,838 / 425 / 0 | 3,942 | 66 / 1,200 | 90.4 / 0.8 | 2,246 | 4,144 | 689 | 5,713 |
| scope/without | 42,821 / 30,720 / 12,101 / 406 / 0 | 2,369 | 0 / 1,490 | 90.7 / 1.2 | 2,807 | 4,144 | 584 | 5,619 |
| loss/without | 43,356 / 38,528 / 4,828 / 456 / 0 | 3,867 | 0 / 1,200 | 97.8 / 0.9 | 2,246 | 4,144 | 709 | 5,699 |
| unrelated/with | 42,867 / 35,584 / 7,283 / 432 / 0 | 2,432 | 0 / 0 | 87.6 / 1.1 | 2,588 | 4,144 | 652 | 5,642 |
| unrelated/without | 42,771 / 36,736 / 6,035 / 463 / 29 | 2,027 | 0 / 0 | 93.4 / 1.1 | 2,588 | 4,144 | 642 | 5,632 |
