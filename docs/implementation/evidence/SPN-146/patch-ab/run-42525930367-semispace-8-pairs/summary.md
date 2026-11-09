## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms, input p95 <= 200 ms, longest task <= 500 ms. Times in ms. CPU throttle (from the metrics): 4x. Competing load: 2 busy-loop processes on the runner during every run; never pool with an unstressed run.

| variant | pair | order | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| previous | 1 | first | 19.1 | 39.8 | 39.8 | 332.0 | 147.3 | 110890e889ac | 0 | pass |
| patched | 1 | second | 16.0 | 39.7 | 39.7 | 272.0 | 128.4 | 4b30f509d742 | 0 | pass |
| patched | 2 | first | 14.1 | 36.6 | 36.6 | 255.0 | 123.5 | 4b30f509d742 | 0 | pass |
| previous | 2 | second | - | - | - | - | - | 110890e889ac | 1 | n/a |
| previous | 3 | first | 19.4 | 41.1 | 41.1 | 293.0 | 109.0 | 110890e889ac | 0 | pass |
| patched | 3 | second | 14.8 | 127.3 | 127.3 | 268.0 | 113.0 | 4b30f509d742 | 1 | fail |
| patched | 4 | first | 17.1 | 31.8 | 31.8 | 358.0 | 171.4 | 4b30f509d742 | 0 | pass |
| previous | 4 | second | 19.4 | 151.0 | 151.0 | 311.0 | 169.0 | 110890e889ac | 1 | fail |
| previous | 5 | first | 13.5 | 48.0 | 89.3 | 263.0 | 161.2 | 110890e889ac | 1 | pass |
| patched | 5 | second | 20.1 | 158.7 | 158.7 | 382.0 | 163.0 | 4b30f509d742 | 1 | fail |
| patched | 6 | first | 15.7 | 79.3 | 79.3 | 248.0 | 163.8 | 4b30f509d742 | 0 | pass |
| previous | 6 | second | 16.6 | 56.4 | 56.4 | 241.0 | 134.2 | 110890e889ac | 0 | pass |
| previous | 7 | first | 15.9 | 36.4 | 36.4 | 253.0 | 154.9 | 110890e889ac | 0 | pass |
| patched | 7 | second | 15.4 | 27.2 | 27.2 | 386.0 | 151.3 | 4b30f509d742 | 0 | pass |
| patched | 8 | first | 17.2 | 98.1 | 98.1 | 224.0 | 146.1 | 4b30f509d742 | 0 | pass |
| previous | 8 | second | 16.7 | 35.5 | 35.5 | 305.0 | 151.4 | 110890e889ac | 1 | pass |

**Over budget per variant:** previous 1 of 7 (budgets), 4 of 8 non-zero exits, patched 2 of 8 (budgets), 2 of 8 non-zero exits. Do not pool these counts with another run or another runner without saying so; one run cannot separate the builds when the tail is rare (1 of 28 previous-build pairs at 4x).

**Harness problems**

- pair-2-previous: missing spn108-metrics.json
- previous: 7 of 8 expected pairs produced metrics
