## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms, input p95 <= 200 ms, longest task <= 500 ms. Times in ms. CPU throttle (from the metrics): 4x. Competing load: 2 busy-loop processes on the runner during every run; never pool with an unstressed run.

| variant | pair | order | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| previous | 1 | first | 13.7 | 24.3 | 24.3 | 281.0 | 133.0 | 110890e889ac | 0 | pass |
| patched | 1 | second | 12.8 | 32.4 | 32.4 | 246.0 | 122.9 | 4b30f509d742 | 0 | pass |
| patched | 2 | first | 15.1 | 26.5 | 26.5 | 294.0 | 105.1 | 4b30f509d742 | 0 | pass |
| previous | 2 | second | 14.2 | 29.1 | 29.1 | 264.0 | 140.2 | 110890e889ac | 0 | pass |
| previous | 3 | first | 11.0 | 26.6 | 26.6 | 300.0 | 157.3 | 110890e889ac | 0 | pass |
| patched | 3 | second | 11.4 | 88.1 | 88.1 | 388.0 | 115.5 | 4b30f509d742 | 0 | pass |
| patched | 4 | first | 12.0 | 20.4 | 20.4 | 221.0 | 132.7 | 4b30f509d742 | 0 | pass |
| previous | 4 | second | 15.7 | 28.0 | 28.0 | 272.0 | 151.4 | 110890e889ac | 0 | pass |
| previous | 5 | first | 14.2 | 28.3 | 28.3 | 374.0 | 166.4 | 110890e889ac | 0 | pass |
| patched | 5 | second | 11.0 | 23.1 | 23.1 | 234.0 | 123.5 | 4b30f509d742 | 0 | pass |
| patched | 6 | first | 10.9 | 20.3 | 20.3 | 192.0 | 115.0 | 4b30f509d742 | 0 | pass |
| previous | 6 | second | 12.5 | 22.8 | 22.8 | 223.0 | 118.1 | 110890e889ac | 0 | pass |
| previous | 7 | first | 13.3 | 26.3 | 26.3 | 204.0 | 118.9 | 110890e889ac | 0 | pass |
| patched | 7 | second | 12.0 | 61.9 | 61.9 | 198.0 | 118.1 | 4b30f509d742 | 0 | pass |
| patched | 8 | first | 11.6 | 36.1 | 36.1 | 185.0 | 96.5 | 4b30f509d742 | 0 | pass |
| previous | 8 | second | 16.9 | 36.9 | 36.9 | 197.0 | 117.1 | 110890e889ac | 0 | pass |

**Over budget per variant:** previous 0 of 8 (budgets), 0 of 8 non-zero exits, patched 0 of 8 (budgets), 0 of 8 non-zero exits. Do not pool these counts with another run or another runner without saying so; one run cannot separate the builds when the tail is rare (1 of 28 previous-build pairs at 4x).
