## SPN-146 hosted Docs A/B (mobile plain-1)

Budget: capacity flush p95 <= 50 ms, paired flush max <= 100 ms, input p95 <= 200 ms, longest task <= 500 ms. Times in ms. CPU throttle (from the metrics): 4x. Competing load: 4 busy-loop processes on the runner during every run; never pool with an unstressed run.

| variant  | pair | order  | flush p95 | flush max | paired flush max | longest task | input p95 | sha          | exit | budget |
| -------- | ---- | ------ | --------- | --------- | ---------------- | ------------ | --------- | ------------ | ---- | ------ |
| previous | 1    | first  | -         | -         | -                | -            | -         | 110890e889ac | 1    | n/a    |
| patched  | 1    | second | -         | -         | -                | -            | -         | 4b30f509d742 | 1    | n/a    |
| patched  | 2    | first  | -         | -         | -                | -            | -         | 4b30f509d742 | 1    | n/a    |
| previous | 2    | second | -         | -         | -                | -            | -         | 110890e889ac | 1    | n/a    |
| previous | 3    | first  | -         | -         | -                | -            | -         | 110890e889ac | 1    | n/a    |
| patched  | 3    | second | -         | -         | -                | -            | -         | 4b30f509d742 | 1    | n/a    |
| patched  | 4    | first  | -         | -         | -                | -            | -         | 4b30f509d742 | 1    | n/a    |
| previous | 4    | second | -         | -         | -                | -            | -         | 110890e889ac | 1    | n/a    |
| previous | 5    | first  | -         | -         | -                | -            | -         | 110890e889ac | 1    | n/a    |
| patched  | 5    | second | -         | -         | -                | -            | -         | 4b30f509d742 | 1    | n/a    |
| patched  | 6    | first  | -         | -         | -                | -            | -         | 4b30f509d742 | 1    | n/a    |
| previous | 6    | second | -         | -         | -                | -            | -         | 110890e889ac | 1    | n/a    |
| previous | 7    | first  | -         | -         | -                | -            | -         | 110890e889ac | 1    | n/a    |
| patched  | 7    | second | -         | -         | -                | -            | -         | 4b30f509d742 | 1    | n/a    |
| patched  | 8    | first  | -         | -         | -                | -            | -         | 4b30f509d742 | 1    | n/a    |
| previous | 8    | second | -         | -         | -                | -            | -         | 110890e889ac | 1    | n/a    |

**Over budget per variant:** previous 0 of 0 (budgets), 8 of 8 non-zero exits, patched 0 of 0 (budgets), 8 of 8 non-zero exits. Do not pool these counts with another run or another runner without saying so; one run cannot separate the builds when the tail is rare (1 of 28 previous-build pairs at 4x).

**Harness problems**

- pair-1-previous: missing spn108-metrics.json
- pair-1-patched: missing spn108-metrics.json
- pair-2-patched: missing spn108-metrics.json
- pair-2-previous: missing spn108-metrics.json
- pair-3-previous: missing spn108-metrics.json
- pair-3-patched: missing spn108-metrics.json
- pair-4-patched: missing spn108-metrics.json
- pair-4-previous: missing spn108-metrics.json
- pair-5-previous: missing spn108-metrics.json
- pair-5-patched: missing spn108-metrics.json
- pair-6-patched: missing spn108-metrics.json
- pair-6-previous: missing spn108-metrics.json
- pair-7-previous: missing spn108-metrics.json
- pair-7-patched: missing spn108-metrics.json
- pair-8-patched: missing spn108-metrics.json
- pair-8-previous: missing spn108-metrics.json
- previous: 0 of 8 expected pairs produced metrics
- patched: 0 of 8 expected pairs produced metrics
