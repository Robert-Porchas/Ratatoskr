# Session diagnostic token comparison

Codex-reported turn.completed.usage from fresh isolated tasks. Total=input+output; cache and reasoning are subsets. No byte-to-token conversion. All failures remain in statistics. Model: gpt-6.1-sol; Codex: codex-cli 0.160.1; browser: 153.0.8010.12; commit: 5436d2cd5e9c59bf161660bf292dcb28876d4ad3; started: 2026-10-06T06:32:26.408Z.

| Scenario | Case | Runs | Median tokens | Min–max | Mean ± SD | Median calls | Inspect calls | Invalid | Success | Diagnosis |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| success | without | 10 | 31,479.5 | 31,422–42,656 | 33,694.6 ± 4,454.1 | 1 | 0 | 0 | 10/10 | 10/10 |
| success | with | 10 | 31,496 | 31,394–42,603 | 33,694.3 ± 4,440.3 | 1 | 0 | 0 | 10/10 | 10/10 |
| missing | with | 10 | 43,154 | 42,870–43,686 | 43,231 ± 234.4 | 2 | 1 | 0 | 10/10 | 10/10 |
| missing | direct | 10 | 150,509 | 136,183–181,072 | 156,974.3 ± 19,848.1 | 18 | 0 | 0 | 10/10 | 10/10 |
| missing | without | 10 | 43,067.5 | 43,028–43,542 | 43,202.5 ± 217.8 | 2 | 1 | 0 | 10/10 | 10/10 |
| loss | with | 10 | 43,260 | 43,233–43,854 | 43,377.3 ± 236.9 | 2 | 1 | 0 | 10/10 | 10/10 |
| loss | without | 10 | 43,778.5 | 43,215–43,810 | 43,572.7 ± 273.9 | 2 | 1 | 0 | 10/10 | 10/10 |
| scope | with | 10 | 43,786.5 | 43,307–55,606 | 44,788.2 ± 3,612.9 | 2 | 1 | 0 | 10/10 | 10/10 |
| scope | direct | 10 | 137,955 | 137,486–138,688 | 137,969.8 ± 337.3 | 19 | 0 | 0 | 10/10 | 10/10 |
| scope | without | 10 | 43,263.5 | 43,224–56,310 | 45,874.9 ± 5,028.7 | 2 | 1 | 0 | 10/10 | 10/10 |
| unrelated | without | 10 | 43,344.5 | 43,189–56,966 | 45,993.2 ± 5,356.2 | 2 | 1 | 0 | 10/10 | 10/10 |
| unrelated | with | 10 | 43,346.5 | 43,198–56,084 | 44,634.2 ± 3,818.4 | 2 | 1 | 0 | 10/10 | 10/10 |

success: with versus without: -0.1% total-token reduction. Diagnostic correctness must be comparable.

missing: with versus direct: 71.3% total-token reduction. Diagnostic correctness must be comparable.

missing: with versus without: -0.2% total-token reduction. Diagnostic correctness must be comparable.

loss: with versus without: 1.2% total-token reduction. Diagnostic correctness must be comparable.

scope: with versus direct: 68.3% total-token reduction. Diagnostic correctness must be comparable.

scope: with versus without: -1.2% total-token reduction. Diagnostic correctness must be comparable.

unrelated: with versus without: -0% total-token reduction. Diagnostic correctness must be comparable.

## Supporting medians (bytes are not tokens)

| Scenario / case | Input / cached / uncached / output / reasoning tokens | Evidence bytes | Session L1 / L2 bytes | Capture / diff ms | Local session bytes | Schema bytes | Args bytes | Workflow ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| success/without | 31,091 / 27,776 / 3,326 / 377.5 / 59 | 116 | 0 / 0 | 80.8 / 1 | 2,233 | 4,144 | 506 | 585.5 |
| success/with | 31,087 / 27,776 / 3,317 / 401.5 / 93.5 | 116 | 0 / 0 | 77.4 / 1 | 2,233 | 4,144 | 514 | 573.5 |
| missing/with | 42,742.5 / 36,160 / 6,819.5 / 423 / 22 | 2,224 | 129 / 1,205 | 89.5 / 0.8 | 1,894 | 4,144 | 589 | 5,635 |
| missing/direct | 149,887 / 133,248 / 13,299.5 / 651 / 0 | 5,981 | 0 / 0 | 0 / 0 | 0 | 15,221 | 441 | 0 |
| missing/without | 42,668.5 / 36,352 / 6,530.5 / 397 / 0 | 2,084 | 0 / 1,205 | 90.9 / 0.8 | 1,894 | 4,144 | 590 | 5,627 |
| loss/with | 42,822 / 37,248 / 5,860 / 438 / 0 | 2,228 | 66 / 1,272 | 97.4 / 0.8 | 2,246 | 4,144 | 685 | 5,697.5 |
| loss/without | 43,341.5 / 38,528 / 4,832 / 438.5 / 0 | 3,937 | 0 / 1,272 | 98.8 / 0.8 | 2,246 | 4,144 | 701 | 5,707 |
| scope/with | 43,366.5 / 35,968 / 7,378.5 / 413 / 0 | 3,320.5 | 134 / 1,562 | 93.3 / 1.2 | 2,807 | 4,144 | 592 | 5,641.5 |
| scope/direct | 137,257 / 123,136 / 14,627.5 / 669 / 0 | 6,084.5 | 0 / 0 | 0 / 0 | 0 | 15,221 | 369.5 | 0 |
| scope/without | 42,850 / 38,528 / 4,770.5 / 416 / 0 | 2,441 | 0 / 1,562 | 92.3 / 1.2 | 2,807 | 4,144 | 588 | 5,638.5 |
| unrelated/without | 42,889 / 38,528 / 6,397 / 465 / 37.5 | 2,434 | 0 / 0 | 92.6 / 1.2 | 2,588 | 4,144 | 639 | 5,642 |
| unrelated/with | 42,893 / 38,528 / 4,546.5 / 451 / 19 | 2,434 | 0 / 0 | 93.1 / 1.2 | 2,588 | 4,144 | 639 | 5,640 |
