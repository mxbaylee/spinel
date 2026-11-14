## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms, input p95 <= 200 ms, longest task <= 500 ms. Times in ms. CPU throttle (from the metrics): 4x. Competing load: 2 busy-loop processes on the runner during every run; never pool with an unstressed run.

| variant  | pair | order  | flush p95 | flush max | paired flush max | longest task | input p95 | sha          | exit | budget |
| -------- | ---- | ------ | --------- | --------- | ---------------- | ------------ | --------- | ------------ | ---- | ------ |
| previous | 1    | first  | 17.9      | 39.6      | 39.6             | 312.0        | 150.6     | 4b30f509d742 | 0    | pass   |
| patched  | 1    | second | 14.6      | 37.3      | 37.3             | 282.0        | 114.8     | 4b30f509d742 | 0    | pass   |
| patched  | 2    | first  | 17.9      | 33.7      | 33.7             | 303.0        | 132.5     | 4b30f509d742 | 0    | pass   |
| previous | 2    | second | 15.8      | 58.0      | 58.0             | 230.0        | 178.7     | 4b30f509d742 | 0    | pass   |
| previous | 3    | first  | 15.5      | 38.5      | 38.5             | 287.0        | 172.5     | 4b30f509d742 | 1    | pass   |
| patched  | 3    | second | 16.7      | 32.5      | 32.5             | 628.0        | 85.2      | 4b30f509d742 | 1    | fail   |
| patched  | 4    | first  | 14.0      | 45.6      | 45.6             | 255.0        | 86.7      | 4b30f509d742 | 0    | pass   |
| previous | 4    | second | 16.4      | 50.3      | 50.3             | 268.0        | 181.5     | 4b30f509d742 | 1    | pass   |
| previous | 5    | first  | 15.9      | 43.6      | 43.6             | 279.0        | 162.9     | 4b30f509d742 | 0    | pass   |
| patched  | 5    | second | 17.4      | 34.2      | 34.2             | 294.0        | 137.9     | 4b30f509d742 | 0    | pass   |
| patched  | 6    | first  | 18.6      | 88.1      | 88.1             | 377.0        | 124.8     | 4b30f509d742 | 0    | pass   |
| previous | 6    | second | 16.6      | 72.2      | 72.2             | 283.0        | 186.8     | 4b30f509d742 | 0    | pass   |
| previous | 7    | first  | 16.5      | 32.1      | 32.1             | 451.0        | 153.8     | 4b30f509d742 | 0    | pass   |
| patched  | 7    | second | 15.0      | 33.7      | 33.7             | 454.0        | 110.0     | 4b30f509d742 | 0    | pass   |
| patched  | 8    | first  | 16.8      | 26.6      | 26.6             | 289.0        | 140.2     | 4b30f509d742 | 0    | pass   |
| previous | 8    | second | 18.2      | 54.6      | 54.6             | 245.0        | 158.4     | 4b30f509d742 | 0    | pass   |

**Over budget per variant:** previous 0 of 8 (budgets), 2 of 8 non-zero exits, patched 1 of 8 (budgets), 1 of 8 non-zero exits. Do not pool these counts with another run or another runner without saying so; one run cannot separate the builds when the tail is rare (1 of 28 previous-build pairs at 4x).
