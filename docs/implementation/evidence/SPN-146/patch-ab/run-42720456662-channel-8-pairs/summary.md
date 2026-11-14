## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms, input p95 <= 200 ms, longest task <= 500 ms. Times in ms. CPU throttle (from the metrics): 4x. Competing load: 2 busy-loop processes on the runner during every run; never pool with an unstressed run.

| variant | pair | order | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| previous | 1 | first | 17.5 | 38.2 | 38.2 | 310.0 | 94.7 | 4b30f509d742 | 0 | pass |
| patched | 1 | second | 15.0 | 32.3 | 32.3 | 195.0 | 114.4 | 4b30f509d742 | 0 | pass |
| patched | 2 | first | 11.4 | 29.0 | 29.0 | 164.0 | 87.2 | 4b30f509d742 | 0 | pass |
| previous | 2 | second | 13.9 | 27.0 | 27.0 | 280.0 | 94.7 | 4b30f509d742 | 0 | pass |
| previous | 3 | first | 13.9 | 48.6 | 48.6 | 344.0 | 88.0 | 4b30f509d742 | 0 | pass |
| patched | 3 | second | 14.1 | 71.9 | 71.9 | 171.0 | 92.8 | 4b30f509d742 | 0 | pass |
| patched | 4 | first | 15.2 | 106.1 | 106.1 | 199.0 | 113.8 | 4b30f509d742 | 1 | fail |
| previous | 4 | second | - | - | - | - | - | 4b30f509d742 | 1 | n/a |
| previous | 5 | first | 13.6 | 37.3 | 37.3 | 321.0 | 104.5 | 4b30f509d742 | 0 | pass |
| patched | 5 | second | 14.3 | 37.5 | 37.5 | 221.0 | 86.9 | 4b30f509d742 | 0 | pass |
| patched | 6 | first | 17.2 | 58.4 | 58.4 | 264.0 | 108.7 | 4b30f509d742 | 0 | pass |
| previous | 6 | second | 14.9 | 40.3 | 40.3 | 369.0 | 104.1 | 4b30f509d742 | 0 | pass |
| previous | 7 | first | 15.1 | 25.4 | 25.4 | 282.0 | 82.3 | 4b30f509d742 | 0 | pass |
| patched | 7 | second | 16.0 | 50.4 | 50.4 | 213.0 | 83.8 | 4b30f509d742 | 0 | pass |
| patched | 8 | first | 14.2 | 36.0 | 36.0 | 150.0 | 84.8 | 4b30f509d742 | 0 | pass |
| previous | 8 | second | 15.9 | 34.5 | 34.5 | 306.0 | 79.7 | 4b30f509d742 | 0 | pass |

**Over budget per variant:** previous 0 of 7 (budgets), 1 of 8 non-zero exits, patched 1 of 8 (budgets), 1 of 8 non-zero exits. Do not pool these counts with another run or another runner without saying so; one run cannot separate the builds when the tail is rare (1 of 28 previous-build pairs at 4x).

**Harness problems**

- pair-4-previous: missing spn108-metrics.json
- previous: 7 of 8 expected pairs produced metrics
