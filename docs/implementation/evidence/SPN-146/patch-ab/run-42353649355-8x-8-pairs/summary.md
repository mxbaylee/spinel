> Note (2026-11-07): this file was written by the summarizer before it counted input p95 and longest task. Under the current all-budget rule patched pair 1 (input p95 205 ms) reads `fail`; see `failures.json`.

## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms. Times in ms. CPU throttle (from the metrics): 8x.

| variant  | pair | order  | flush p95 | flush max | paired flush max | longest task | input p95 | sha          | exit | budget |
| -------- | ---- | ------ | --------- | --------- | ---------------- | ------------ | --------- | ------------ | ---- | ------ |
| previous | 1    | first  | 13.7      | 30.5      | 30.5             | 306.0        | 157.5     | 110890e889ac | 0    | pass   |
| patched  | 1    | second | 14.8      | 42.6      | 42.6             | 412.0        | 205.0     | 4b30f509d742 | 1    | pass   |
| patched  | 2    | first  | 12.0      | 30.1      | 30.1             | 267.0        | 151.7     | 4b30f509d742 | 0    | pass   |
| previous | 2    | second | 14.2      | 58.9      | 58.9             | 378.0        | 156.2     | 110890e889ac | 0    | pass   |
| previous | 3    | first  | 16.7      | 118.1     | 118.1            | 341.0        | 167.7     | 110890e889ac | 1    | fail   |
| patched  | 3    | second | 15.6      | 76.2      | 76.2             | 309.0        | 158.6     | 4b30f509d742 | 1    | pass   |
| patched  | 4    | first  | 13.1      | 77.7      | 77.7             | 268.0        | 134.7     | 4b30f509d742 | 0    | pass   |
| previous | 4    | second | 13.4      | 56.6      | 56.6             | 255.0        | 138.8     | 110890e889ac | 0    | pass   |
| previous | 5    | first  | 14.6      | 88.3      | 88.3             | 285.0        | 146.2     | 110890e889ac | 0    | pass   |
| patched  | 5    | second | 12.0      | 76.9      | 76.9             | 235.0        | 125.9     | 4b30f509d742 | 0    | pass   |
| patched  | 6    | first  | 14.2      | 72.5      | 72.5             | 250.0        | 131.0     | 4b30f509d742 | 0    | pass   |
| previous | 6    | second | 12.9      | 27.1      | 27.1             | 224.0        | 129.4     | 110890e889ac | 0    | pass   |
| previous | 7    | first  | 13.9      | 24.4      | 24.4             | 316.0        | 127.4     | 110890e889ac | 0    | pass   |
| patched  | 7    | second | 11.7      | 27.3      | 27.3             | 271.0        | 125.6     | 4b30f509d742 | 0    | pass   |
| patched  | 8    | first  | 10.4      | 61.7      | 61.7             | 264.0        | 128.2     | 4b30f509d742 | 0    | pass   |
| previous | 8    | second | 11.8      | 29.5      | 29.5             | 325.0        | 151.7     | 110890e889ac | 0    | pass   |

**Over budget per variant:** previous 1 of 8, patched 0 of 8. Do not pool these counts with another run or another runner without saying so; the rate is about 1 in 12 and a single run cannot separate the builds.
