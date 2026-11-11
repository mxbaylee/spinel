## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms. Times in ms. CPU throttle (from the metrics): 6x.

| variant | pair | order | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| previous | 1 | first | 15.5 | 33.6 | 33.6 | 243.0 | 157.3 | 110890e889ac | 0 | pass |
| patched | 1 | second | 12.5 | 32.7 | 32.7 | 293.0 | 148.9 | 4b30f509d742 | 0 | pass |
| patched | 2 | first | 12.8 | 71.0 | 71.0 | 310.0 | 136.0 | 4b30f509d742 | 0 | pass |
| previous | 2 | second | 16.8 | 77.3 | 77.3 | 237.0 | 138.6 | 110890e889ac | 0 | pass |
| previous | 3 | first | 13.6 | 82.1 | 82.1 | 264.0 | 138.8 | 110890e889ac | 0 | pass |
| patched | 3 | second | 12.9 | 74.5 | 74.5 | 250.0 | 139.7 | 4b30f509d742 | 0 | pass |
| patched | 4 | first | 11.4 | 27.9 | 27.9 | 219.0 | 141.3 | 4b30f509d742 | 0 | pass |
| previous | 4 | second | 12.1 | 27.6 | 27.6 | 216.0 | 140.2 | 110890e889ac | 0 | pass |
| previous | 5 | first | 13.4 | 29.5 | 29.5 | 281.0 | 146.6 | 110890e889ac | 0 | pass |
| patched | 5 | second | 13.6 | 34.0 | 42.0 | 242.0 | 138.2 | 4b30f509d742 | 0 | pass |
| patched | 6 | first | 12.2 | 29.7 | 29.7 | 284.0 | 150.3 | 4b30f509d742 | 0 | pass |
| previous | 6 | second | 14.4 | 66.4 | 66.4 | 294.0 | 141.5 | 110890e889ac | 0 | pass |
| previous | 7 | first | 14.6 | 60.0 | 60.0 | 233.0 | 143.8 | 110890e889ac | 0 | pass |
| patched | 7 | second | 12.0 | 44.8 | 44.8 | 304.0 | 149.6 | 4b30f509d742 | 0 | pass |
| patched | 8 | first | 11.0 | 62.6 | 62.6 | 266.0 | 147.1 | 4b30f509d742 | 0 | pass |
| previous | 8 | second | 15.3 | 29.8 | 29.8 | 224.0 | 142.2 | 110890e889ac | 0 | pass |

**Over budget per variant:** previous 0 of 8, patched 0 of 8. Do not pool these counts with another run or another runner without saying so; the rate is about 1 in 12 and a single run cannot separate the builds.
