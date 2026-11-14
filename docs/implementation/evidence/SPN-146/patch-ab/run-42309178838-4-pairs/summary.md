## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms. Times in ms.

| variant | pair | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| previous | 1 | 25.0 | 40.1 | 40.1 | 191.0 | 100.8 | 110890e889ac | 0 | pass |
| patched | 1 | 19.4 | 31.7 | 31.7 | 176.0 | 100.9 | 4b30f509d742 | 0 | pass |
| previous | 2 | 21.8 | 108.6 | 108.6 | 184.0 | 104.0 | 110890e889ac | 1 | fail |
| patched | 2 | 20.8 | 32.2 | 32.2 | 229.0 | 103.9 | 4b30f509d742 | 0 | pass |
| previous | 3 | 21.2 | 33.3 | 33.3 | 208.0 | 102.8 | 110890e889ac | 0 | pass |
| patched | 3 | 18.7 | 32.2 | 32.2 | 198.0 | 103.5 | 4b30f509d742 | 0 | pass |
| previous | 4 | 23.0 | 31.8 | 31.8 | 240.0 | 100.1 | 110890e889ac | 0 | pass |
| patched | 4 | 18.9 | 28.8 | 28.8 | 172.0 | 100.8 | 4b30f509d742 | 0 | pass |
