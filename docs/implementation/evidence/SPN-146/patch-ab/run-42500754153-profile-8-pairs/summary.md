## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms, input p95 <= 200 ms, longest task <= 500 ms. Times in ms. CPU throttle (from the metrics): 4x. Competing load: 2 busy-loop processes on the runner during every run; never pool with an unstressed run.

| variant | pair | order | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| previous | 1 | first | 15.7 | 84.8 | 84.8 | 237.0 | 94.3 | 110890e889ac | 0 | pass |
| patched | 1 | second | 11.0 | 20.8 | 20.8 | 155.0 | 107.0 | 4b30f509d742 | 0 | pass |
| patched | 2 | first | 12.0 | 21.6 | 21.6 | 180.0 | 97.6 | 4b30f509d742 | 0 | pass |
| previous | 2 | second | 13.9 | 30.7 | 30.7 | 218.0 | 97.7 | 110890e889ac | 0 | pass |
| previous | 3 | first | 11.9 | 19.0 | 19.0 | 217.0 | 94.0 | 110890e889ac | 0 | pass |
| patched | 3 | second | 12.7 | 35.8 | 35.8 | 246.0 | 94.0 | 4b30f509d742 | 0 | pass |
| patched | 4 | first | 11.4 | 21.9 | 21.9 | 196.0 | 91.7 | 4b30f509d742 | 0 | pass |
| previous | 4 | second | 12.3 | 40.9 | 40.9 | 171.0 | 94.9 | 110890e889ac | 0 | pass |
| previous | 5 | first | 15.1 | 25.8 | 25.8 | 172.0 | 98.9 | 110890e889ac | 0 | pass |
| patched | 5 | second | 10.4 | 60.6 | 60.6 | 194.0 | 91.4 | 4b30f509d742 | 0 | pass |
| patched | 6 | first | 13.4 | 31.6 | 31.6 | 217.0 | 90.7 | 4b30f509d742 | 0 | pass |
| previous | 6 | second | 12.4 | 21.3 | 21.3 | 203.0 | 92.6 | 110890e889ac | 0 | pass |
| previous | 7 | first | 13.2 | 23.6 | 23.6 | 176.0 | 86.0 | 110890e889ac | 0 | pass |
| patched | 7 | second | 9.8 | 21.8 | 21.8 | 225.0 | 85.9 | 4b30f509d742 | 0 | pass |
| patched | 8 | first | 11.2 | 21.2 | 21.2 | 215.0 | 95.2 | 4b30f509d742 | 0 | pass |
| previous | 8 | second | 13.2 | 60.5 | 60.5 | 186.0 | 100.7 | 110890e889ac | 0 | pass |

**Over budget per variant:** previous 0 of 8 (budgets), 0 of 8 non-zero exits, patched 0 of 8 (budgets), 0 of 8 non-zero exits. Do not pool these counts with another run or another runner without saying so; one run cannot separate the builds when the tail is rare (1 of 28 previous-build pairs at 4x).
