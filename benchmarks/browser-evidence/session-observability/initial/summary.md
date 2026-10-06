# Session diagnostic token comparison

Codex-reported turn.completed.usage from fresh isolated tasks. Total=input+output; cache and reasoning are subsets. No byte-to-token conversion. All failures remain in statistics. Model: gpt-6.1-sol; Codex: codex-cli 0.160.1; browser: 153.0.8010.12; commit: 5d7cb44d23866e9210fab7ccbd0dda3ad97821ca; started: 2026-10-06T05:41:00.725Z.

| Scenario | Case | Runs | Median tokens | Min–max | Mean ± SD | Median calls | Inspect calls | Invalid | Success | Diagnosis |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| success | without | 10 | 42,888 | 31,456–54,109 | 41,739.3 ± 6,111 | 2 | 1 | 0 | 9/10 | 9/10 |
| success | with | 10 | 48,479.5 | 31,433–94,599 | 49,268.2 ± 17,904 | 2.5 | 1.5 | 0 | 9/10 | 9/10 |
| missing | with | 10 | 43,560 | 43,076–66,694 | 45,819.3 ± 6,959.7 | 2 | 1 | 0 | 10/10 | 10/10 |
| missing | direct | 10 | N/A | N/A | N/A | 22.5 | 0 | 0 | 4/10 | 4/10 |
| missing | without | 10 | 55,521.5 | 43,491–67,563 | 52,056 ± 7,756.3 | 2 | 1 | 0 | 10/10 | 10/10 |
| loss | without | 10 | 55,540.5 | 43,140–56,546 | 50,919.9 ± 6,095.6 | 2 | 1 | 0 | 10/10 | 10/10 |
| loss | with | 10 | 43,777.5 | 43,182–56,605 | 47,186.9 ± 5,599.1 | 2 | 1 | 0 | 10/10 | 10/10 |
| scope | with | 10 | 49,896.5 | 43,276–56,234 | 49,866.4 ± 6,195.6 | 2 | 1 | 0 | 10/10 | 10/10 |
| scope | direct | 10 | N/A | N/A | N/A | 23.5 | 0 | 0 | 2/10 | 2/10 |
| scope | without | 10 | 43,707 | 43,633–56,379 | 48,680.4 ± 6,139.6 | 2 | 1 | 0 | 10/10 | 10/10 |
| unrelated | with | 10 | 56,461 | 55,837–70,688 | 60,327.6 ± 6,277.9 | 3 | 2 | 0 | 10/10 | 10/10 |
| unrelated | without | 10 | 55,963.5 | 55,851–70,589 | 60,055.4 ± 6,321.8 | 3 | 2 | 0 | 10/10 | 10/10 |

success: with versus without: -13% total-token reduction. Diagnostic correctness must be comparable.

missing: with versus direct: N/A. Diagnostic correctness must be comparable.

missing: with versus without: 21.5% total-token reduction. Diagnostic correctness must be comparable.

loss: with versus without: 21.2% total-token reduction. Diagnostic correctness must be comparable.

scope: with versus direct: N/A. Diagnostic correctness must be comparable.

scope: with versus without: -14.2% total-token reduction. Diagnostic correctness must be comparable.

unrelated: with versus without: -0.9% total-token reduction. Diagnostic correctness must be comparable.

## Supporting medians (bytes are not tokens)

| Scenario / case | Input / cached / uncached / output / reasoning tokens | Evidence bytes | Session L1 / L2 bytes | Capture / diff ms | Local session bytes | Schema bytes | Args bytes | Workflow ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| success/without | 42,453.5 / 30,592 / 11,791 / 423.5 / 66 | 1,573.5 | 0 / 0 | 68 / 1.1 | 2,233 | 4,144 | 572 | 598.5 |
| success/with | 48,062.5 / 36,032 / 12,030.5 / 452.5 / 75.5 | 1,692 | 0 / 631 | 75.1 / 1.3 | 2,233 | 4,144 | 603 | 606 |
| missing/with | 43,150.5 / 29,824 / 13,553.5 / 407.5 / 0 | 3,623 | 129 / 1,133 | 78.7 / 0.8 | 1,894 | 4,144 | 606 | 5,659 |
| missing/direct | N/A / N/A / N/A / N/A / N/A | 5,703.5 | 0 / 0 | 0 / 0 | 0 | 15,221 | 586 | 0 |
| missing/without | 55,042.5 / 38,528 / 12,456 / 464.5 / 46.5 | 3,483 | 0 / 1,133 | 74.4 / 0.8 | 1,894 | 4,144 | 610 | 5,649.5 |
| loss/without | 54,996 / 32,064 / 11,998.5 / 518.5 / 25.5 | 3,868 | 0 / 1,200 | 74.3 / 0.9 | 2,246 | 4,144 | 709 | 5,712 |
| loss/with | 43,338 / 37,056 / 9,610 / 447 / 0 | 3,944 | 66 / 1,200 | 77.9 / 0.9 | 2,246 | 4,144 | 695 | 5,707.5 |
| scope/with | 49,372 / 39,104 / 10,307.5 / 494.5 / 20.5 | 3,985 | 134 / 1,490 | 73.8 / 1.2 | 2,807 | 4,144 | 596 | 5,628.5 |
| scope/direct | N/A / N/A / N/A / N/A / N/A | 5,397 | 0 / 0 | 0 / 0 | 0 | 15,221 | 573.5 | 0 |
| scope/without | 43,272 / 38,528 / 6,548.5 / 438.5 / 11.5 | 3,840 | 0 / 1,490 | 73 / 1.2 | 2,807 | 4,144 | 592 | 5,637 |
| unrelated/with | 55,920.5 / 50,304 / 9,048.5 / 543.5 / 30.5 | 15,192.5 | 0 / 1,262 | 74.2 / 1.2 | 2,588 | 4,144 | 724 | 5,638 |
| unrelated/without | 55,435.5 / 50,304 / 5,742 / 538.5 / 37.5 | 3,932 | 0 / 1,262 | 74.7 / 1.2 | 2,588 | 4,144 | 740 | 5,628.5 |
