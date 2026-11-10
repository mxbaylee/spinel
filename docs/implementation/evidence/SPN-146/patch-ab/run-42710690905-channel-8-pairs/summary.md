## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms, input p95 <= 200 ms, longest task <= 500 ms. Times in ms. CPU throttle (from the metrics): 4x. Competing load: 2 busy-loop processes on the runner during every run; never pool with an unstressed run.

| variant | pair | order | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| previous | 1 | first | 13.0 | 30.1 | 30.1 | 263.0 | 80.8 | 4b30f509d742 | 0 | pass |
| patched | 1 | second | 11.1 | 27.0 | 27.0 | 216.0 | 61.8 | 4b30f509d742 | 0 | pass |
| patched | 2 | first | 10.5 | 23.2 | 23.2 | 110.0 | 73.9 | 4b30f509d742 | 0 | pass |
| previous | 2 | second | 13.1 | 26.1 | 26.1 | 344.0 | 83.2 | 4b30f509d742 | 0 | pass |
| previous | 3 | first | 9.4 | 21.6 | 21.6 | 175.0 | 61.5 | 4b30f509d742 | 0 | pass |
| patched | 3 | second | 10.7 | 30.4 | 30.4 | 256.0 | 83.7 | 4b30f509d742 | 0 | pass |
| patched | 4 | first | 11.0 | 19.7 | 19.7 | 161.0 | 82.6 | 4b30f509d742 | 0 | pass |
| previous | 4 | second | 10.7 | 26.1 | 26.1 | 312.0 | 84.9 | 4b30f509d742 | 0 | pass |
| previous | 5 | first | 13.5 | 105.1 | 105.1 | 229.0 | 61.7 | 4b30f509d742 | 1 | fail |
| patched | 5 | second | 9.7 | 22.2 | 22.2 | 132.0 | 81.7 | 4b30f509d742 | 0 | pass |
| patched | 6 | first | 10.9 | 28.4 | 28.4 | 167.0 | 83.0 | 4b30f509d742 | 0 | pass |
| previous | 6 | second | - | - | - | - | - | 4b30f509d742 | 1 | n/a |
| previous | 7 | first | 12.2 | 124.5 | 124.5 | 238.0 | 81.9 | 4b30f509d742 | 1 | fail |
| patched | 7 | second | 11.0 | 24.3 | 24.3 | 107.0 | 71.6 | 4b30f509d742 | 0 | pass |
| patched | 8 | first | 10.4 | 22.7 | 22.7 | 109.0 | 62.9 | 4b30f509d742 | 0 | pass |
| previous | 8 | second | 9.8 | 22.2 | 22.2 | 422.0 | 70.4 | 4b30f509d742 | 0 | pass |

**Over budget per variant:** previous 2 of 7 (budgets), 3 of 8 non-zero exits, patched 0 of 8 (budgets), 0 of 8 non-zero exits. Do not pool these counts with another run or another runner without saying so; one run cannot separate the builds when the tail is rare (1 of 28 previous-build pairs at 4x).

**Harness problems**

- pair-6-previous: missing spn108-metrics.json
- previous: 7 of 8 expected pairs produced metrics
