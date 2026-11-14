## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms, input p95 <= 200 ms, longest task <= 500 ms. Times in ms. CPU throttle (from the metrics): 4x. Competing load: 2 busy-loop processes on the runner during every run; never pool with an unstressed run.

| variant | pair | order | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| previous | 1 | first | 26.0 | 69.9 | 69.9 | 306.0 | 165.4 | 110890e889ac | 0 | pass |
| patched | 1 | second | 25.7 | 51.3 | 51.3 | 286.0 | 187.4 | 4b30f509d742 | 1 | pass |
| patched | 2 | first | 23.5 | 47.3 | 47.3 | 289.0 | 184.1 | 4b30f509d742 | 1 | pass |
| previous | 2 | second | 23.1 | 69.8 | 69.8 | 279.0 | 180.0 | 110890e889ac | 1 | pass |
| previous | 3 | first | 25.5 | 73.6 | 73.6 | 360.0 | 204.5 | 110890e889ac | 1 | fail |
| patched | 3 | second | 21.2 | 72.4 | 72.4 | 374.0 | 200.4 | 4b30f509d742 | 1 | fail |
| patched | 4 | first | 19.5 | 46.7 | 46.7 | 248.0 | 169.0 | 4b30f509d742 | 0 | pass |
| previous | 4 | second | 25.3 | 72.0 | 72.0 | 273.0 | 188.1 | 110890e889ac | 0 | pass |
| previous | 5 | first | 25.5 | 77.2 | 77.2 | 322.0 | 206.7 | 110890e889ac | 1 | fail |
| patched | 5 | second | 22.1 | 39.5 | 39.5 | 267.0 | 188.8 | 4b30f509d742 | 1 | pass |
| patched | 6 | first | 26.7 | 76.9 | 76.9 | 306.0 | 190.7 | 4b30f509d742 | 1 | pass |
| previous | 6 | second | 24.6 | 71.8 | 71.8 | 270.0 | 205.4 | 110890e889ac | 1 | fail |
| previous | 7 | first | - | - | - | - | - | 110890e889ac | 1 | n/a |
| patched | 7 | second | 20.8 | 37.3 | 37.3 | 271.0 | 194.4 | 4b30f509d742 | 0 | pass |
| patched | 8 | first | 22.9 | 42.0 | 42.0 | 452.0 | 210.5 | 4b30f509d742 | 1 | fail |
| previous | 8 | second | 28.0 | 62.1 | 62.1 | 252.0 | 160.5 | 110890e889ac | 0 | pass |

**Over budget per variant:** previous 3 of 7 (budgets), 5 of 8 non-zero exits, patched 2 of 8 (budgets), 6 of 8 non-zero exits. Do not pool these counts with another run or another runner without saying so; one run cannot separate the builds when the tail is rare (1 of 28 previous-build pairs at 4x).

**Harness problems**

- pair-7-previous: missing spn108-metrics.json
- previous: 7 of 8 expected pairs produced metrics
