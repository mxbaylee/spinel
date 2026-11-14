## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms. Times in ms.

| variant  | pair | flush p95 | flush max | paired flush max | longest task | input p95 | sha          | exit | budget |
| -------- | ---- | --------- | --------- | ---------------- | ------------ | --------- | ------------ | ---- | ------ |
| previous | 1    | 7.6       | 35.2      | 35.2             | 186.0        | 85.6      | 110890e889ac | 0    | pass   |
| patched  | 1    | 8.9       | 17.5      | 17.5             | 148.0        | 85.2      | 4b30f509d742 | 0    | pass   |
| previous | 2    | 9.8       | 30.7      | 30.7             | 164.0        | 88.9      | 110890e889ac | 0    | pass   |
| patched  | 2    | 7.3       | 35.8      | 35.8             | 154.0        | 87.9      | 4b30f509d742 | 0    | pass   |
| previous | 3    | 7.8       | 17.1      | 17.1             | 143.0        | 85.8      | 110890e889ac | 0    | pass   |
| patched  | 3    | 7.1       | 44.8      | 44.8             | 148.0        | 86.1      | 4b30f509d742 | 0    | pass   |
| previous | 4    | 8.9       | 39.5      | 39.5             | 146.0        | 87.2      | 110890e889ac | 0    | pass   |
| patched  | 4    | 6.8       | 42.9      | 42.9             | 190.0        | 87.3      | 4b30f509d742 | 0    | pass   |
| previous | 5    | 8.4       | 26.8      | 26.8             | 174.0        | 88.3      | 110890e889ac | 0    | pass   |
| patched  | 5    | 8.2       | 33.9      | 33.9             | 156.0        | 86.2      | 4b30f509d742 | 0    | pass   |
| previous | 6    | 10.0      | 32.3      | 32.3             | 190.0        | 88.3      | 110890e889ac | 0    | pass   |
| patched  | 6    | 7.0       | 45.0      | 45.0             | 162.0        | 86.2      | 4b30f509d742 | 0    | pass   |
| previous | 7    | 8.9       | 17.9      | 17.9             | 138.0        | 86.2      | 110890e889ac | 0    | pass   |
| patched  | 7    | 7.8       | 44.1      | 44.1             | 147.0        | 86.9      | 4b30f509d742 | 0    | pass   |
| previous | 8    | 9.3       | 43.4      | 43.4             | 175.0        | 96.4      | 110890e889ac | 0    | pass   |
| patched  | 8    | 7.7       | 17.1      | 17.1             | 152.0        | 83.8      | 4b30f509d742 | 0    | pass   |
