## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms, input p95 <= 200 ms, longest task <= 500 ms. Times in ms. CPU throttle (from the metrics): 4x. Competing load: 2 busy-loop processes on the runner during every run; never pool with an unstressed run.

| variant | pair | order | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| previous | 1 | first | 18.0 | 40.1 | 40.1 | 272.0 | 153.1 | 110890e889ac | 0 | pass |
| patched | 1 | second | 16.2 | 56.0 | 56.0 | 268.0 | 184.4 | 4b30f509d742 | 0 | pass |
| patched | 2 | first | 16.3 | 62.8 | 62.8 | 279.0 | 175.5 | 4b30f509d742 | 0 | pass |
| previous | 2 | second | 15.7 | 48.8 | 48.8 | 232.0 | 153.8 | 110890e889ac | 0 | pass |
| previous | 3 | first | 16.5 | 56.7 | 56.7 | 276.0 | 181.7 | 110890e889ac | 0 | pass |
| patched | 3 | second | 12.6 | 78.7 | 78.7 | 320.0 | 108.2 | 4b30f509d742 | 0 | pass |
| patched | 4 | first | 14.9 | 23.6 | 23.6 | 330.0 | 183.6 | 4b30f509d742 | 1 | pass |
| previous | 4 | second | 16.7 | 40.3 | 40.3 | 279.0 | 140.8 | 110890e889ac | 0 | pass |
| previous | 5 | first | 17.8 | 53.2 | 53.2 | 234.0 | 150.0 | 110890e889ac | 0 | pass |
| patched | 5 | second | 17.0 | 29.5 | 29.5 | 235.0 | 122.8 | 4b30f509d742 | 0 | pass |
| patched | 6 | first | 16.0 | 205.6 | 205.6 | 302.0 | 150.0 | 4b30f509d742 | 1 | fail |
| previous | 6 | second | 18.8 | 130.4 | 130.4 | 297.0 | 173.4 | 110890e889ac | 1 | fail |
| previous | 7 | first | 16.7 | 130.0 | 130.0 | 262.0 | 161.5 | 110890e889ac | 1 | fail |
| patched | 7 | second | 17.2 | 42.0 | 42.0 | 243.0 | 122.9 | 4b30f509d742 | 0 | pass |
| patched | 8 | first | 17.0 | 73.3 | 73.3 | 284.0 | 186.6 | 4b30f509d742 | 1 | pass |
| previous | 8 | second | 19.7 | 52.2 | 77.3 | 283.0 | 190.5 | 110890e889ac | 1 | pass |

**Over budget per variant:** previous 2 of 8 (budgets), 3 of 8 non-zero exits, patched 1 of 8 (budgets), 3 of 8 non-zero exits. Do not pool these counts with another run or another runner without saying so; one run cannot separate the builds when the tail is rare (1 of 28 previous-build pairs at 4x).
