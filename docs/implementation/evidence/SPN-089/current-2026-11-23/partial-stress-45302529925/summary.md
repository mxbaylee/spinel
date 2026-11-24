## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms, input p95 <= 200 ms, longest task <= 500 ms. Times in ms. CPU throttle (from the metrics): 4x. Competing load: 2 busy-loop processes on the runner during every run; never pool with an unstressed run.

| variant | pair | order | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| previous | 1 | first | 16.8 | 38.9 | 38.9 | 250.0 | 110.5 | 83b7c9780e3c | 0 | pass |
| patched | 1 | second | 17.1 | 30.1 | 30.1 | 212.0 | 124.5 | 788566fd844a | 0 | pass |
| patched | 2 | first | 13.5 | 28.3 | 28.3 | 160.0 | 115.6 | 788566fd844a | 0 | pass |
| previous | 2 | second | - | - | - | - | - | 83b7c9780e3c | - | n/a |

**Over budget per variant:** previous 0 of 1 (budgets), 1 of 2 non-zero exits, patched 0 of 2 (budgets), 0 of 2 non-zero exits. Do not pool these counts with another run or another runner without saying so; one run cannot separate the builds when the tail is rare (1 of 28 previous-build pairs at 4x).

**Harness problems**

- pair-2-previous: missing spn108-metrics.json
- previous: 1 of 8 expected pairs produced metrics
- patched: 2 of 8 expected pairs produced metrics
