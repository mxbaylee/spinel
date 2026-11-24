## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms. Times in ms.

| variant | pair | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| previous | 1 | 8.2 | 14.6 | 14.6 | 147.0 | 63.1 | 110890e889ac | 0 | pass |
| patched | 1 | 6.6 | 14.7 | 14.7 | 119.0 | 65.7 | 4b30f509d742 | 0 | pass |
| previous | 2 | 7.6 | 45.4 | 45.4 | 139.0 | 66.8 | 110890e889ac | 0 | pass |
| patched | 2 | 5.3 | 14.5 | 14.5 | 126.0 | 63.4 | 4b30f509d742 | 0 | pass |
| previous | 3 | 8.0 | 41.3 | 41.3 | 140.0 | 67.7 | 110890e889ac | 0 | pass |
| patched | 3 | 6.8 | 14.8 | 14.8 | 134.0 | 65.1 | 4b30f509d742 | 0 | pass |
| previous | 4 | 8.2 | 34.1 | 34.1 | 123.0 | 65.9 | 110890e889ac | 0 | pass |
| patched | 4 | 5.8 | 14.0 | 14.0 | 134.0 | 69.1 | 4b30f509d742 | 0 | pass |
| previous | 5 | 7.2 | 13.0 | 13.0 | 171.0 | 70.7 | 110890e889ac | 0 | pass |
| patched | 5 | 6.4 | 15.2 | 15.2 | 153.0 | 66.3 | 4b30f509d742 | 0 | pass |
| previous | 6 | 6.1 | 14.3 | 14.3 | 118.0 | 71.6 | 110890e889ac | 0 | pass |
| patched | 6 | 5.9 | 13.5 | 13.5 | 117.0 | 63.0 | 4b30f509d742 | 0 | pass |
| previous | 7 | 5.8 | 12.2 | 12.2 | 120.0 | 61.1 | 110890e889ac | 0 | pass |
| patched | 7 | 5.4 | 24.0 | 24.0 | 138.0 | 70.1 | 4b30f509d742 | 0 | pass |
| previous | 8 | 6.1 | 12.8 | 12.8 | 146.0 | 75.1 | 110890e889ac | 0 | pass |
| patched | 8 | 9.1 | 34.5 | 34.5 | 141.0 | 67.9 | 4b30f509d742 | 0 | pass |
