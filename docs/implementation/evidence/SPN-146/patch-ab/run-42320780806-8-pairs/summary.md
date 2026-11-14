## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms. Times in ms.

| variant | pair | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| previous | 1 | 8.1 | 18.5 | 18.5 | 157.0 | 92.3 | 110890e889ac | 0 | pass |
| patched | 1 | 7.3 | 31.7 | 31.7 | 155.0 | 91.0 | 4b30f509d742 | 0 | pass |
| previous | 2 | 7.8 | 34.9 | 34.9 | 201.0 | 92.4 | 110890e889ac | 0 | pass |
| patched | 2 | 7.9 | 19.2 | 19.2 | 161.0 | 99.5 | 4b30f509d742 | 0 | pass |
| previous | 3 | 9.8 | 20.7 | 20.7 | 147.0 | 83.1 | 110890e889ac | 0 | pass |
| patched | 3 | 7.8 | 18.7 | 18.7 | 145.0 | 89.3 | 4b30f509d742 | 0 | pass |
| previous | 4 | 9.9 | 36.2 | 36.2 | 169.0 | 94.6 | 110890e889ac | 0 | pass |
| patched | 4 | 8.1 | 43.4 | 43.4 | 169.0 | 98.8 | 4b30f509d742 | 0 | pass |
| previous | 5 | 9.0 | 27.7 | 27.7 | 147.0 | 88.6 | 110890e889ac | 0 | pass |
| patched | 5 | 9.8 | 41.1 | 41.1 | 178.0 | 105.5 | 4b30f509d742 | 0 | pass |
| previous | 6 | 9.2 | 21.2 | 21.2 | 177.0 | 89.8 | 110890e889ac | 0 | pass |
| patched | 6 | 8.6 | 38.6 | 38.6 | 209.0 | 87.8 | 4b30f509d742 | 0 | pass |
| previous | 7 | 8.0 | 19.3 | 19.3 | 155.0 | 92.5 | 110890e889ac | 0 | pass |
| patched | 7 | 8.4 | 18.3 | 18.3 | 167.0 | 90.5 | 4b30f509d742 | 0 | pass |
| previous | 8 | 7.5 | 19.8 | 19.8 | 162.0 | 91.4 | 110890e889ac | 0 | pass |
| patched | 8 | 8.3 | 19.4 | 19.4 | 138.0 | 85.7 | 4b30f509d742 | 0 | pass |
