# 🧾 SPN-090 terminal hosted checkpoint

Collected 2026-11-14T03:30:00.408381+00:00. This archive is a child of the immutable first-failure archive `fdc2d7351527607ed67d3d540df7ae22e19a9db6`; its original partial observation and full recovery failure remain unchanged.

All three workflows are attempt 1 for source `67111d9c106c6518b813c6f1cf332068526c254c`, base `ebf0842f51b60d54649cf8a03065914bec0944bf`, tested merge `3a97ee4dcf0bc60c9918575f0d8cf4eced7bc1d4`. Full paginated terminal jobs/artifact APIs and run APIs are retained. CI 43548838838: 33 terminal jobs, 30 success and 3 failure. Native desktop 43548838849: 3/3 success. Storybook 43548838841: 10 terminal jobs, 8 success and two preview/deployment skips; all five full-catalog variants and aggregate passed.

## 🚦 Actual gates and blocker

Backlog, Pull request, Lint, Typecheck and Lib tests pass. Unit tests fails on recovery job 132306723772; required Playwright smoke aggregate 132314895913 also fails closed because its required Unit dependency failed, although every actual browser/responsiveness worker passed. Both aggregate JSONs bind exact plan digest `1e11f7aeb0fd2c7b6b8d810c697ad49ff928bbe29a85724b2b67e12281c26f70`. All 15 suites were selected by the conservative full plan. No failure is waived, cancelled or rerun. SPN-090 remains blocked on SPN-158 registration/repair and actual new-head acceptance; SPN-157 separately owns the named failures observed on SPN-098 candidate2204, with cause/stage uncertainty retained.

## 🔬 Selected current acceptance

Production 2/2 job132306724084: 85 passed, 12.3 minutes, including warm/first-list-failed native Doc content, real403 refusal, same-editor unfinished Sheet input through delayed failed metadata/reconnect, and downloaded Sheet/Doc local-image plus offline manifest/icon-byte assertions at offline.spec.ts:292. The exact full case source is retained compressed, not a shell-only inference. Development shards74 passed/3 skipped and75 passed/1 skipped; production1/2 83 passed/3 skipped; mobileHTTPS10 passed/3 skipped. Skips remain explicit, and none of the new SPN-090 cases was skipped. Remaining Unit2169/190files and supervisor131/1file passed; recovery606/607 failed as originally preserved. Successful supervisor cases do not diagnose or close SPN-157.

Native reports preserve exact source/tested identity and four native ordinary-profile launches for each Chrome/Firefox/Safari. They cover retained downloaded/pending Doc/Sheet/images, replay, conflict preservation and cleared-storage refusal; they are desktop observations, not phone claims. Five full Storybook manifests each checked1043 entries with0 failures. Manifest identity is bound through the exact-source workflow and downloaded ZIP hash, not an invented embedded source field. Current hosted Linux captures need not be byte-identical to the independently reviewed Mac images.

Both responsiveness presets passed with candidate integrity and timing validity; physicalDevice=false. Desktop candidate first-verified-browser-local-empty samples are344.6–350.4ms; mobile369.4–377.5ms, within the existing1000ms gate. The later server read upper bounds remain descriptive; this is not a new threshold or physical phone result. Full comparison JSONs retain attribution limits and baseline context.

## 🔎 Compact preservation and privacy

Downloaded ZIP hashes were verified against GitHub artifact digests for every native report, all five Storybook manifests, full build, plan/gate artifacts and both responsiveness reports. Large screenshot ZIPs remain local/hosted and are represented here by hashes and compact manifests; no whole binary dump is included. Selected complete logs, immutable source, JSON reports and all terminal API metadata are gzip-compressed with original bytes intact. Payload SHA256 values and the privacy scan are in manifest.json. No databases, browser profiles, cookie stores, environment files or real user content are included; native actor/document identifiers belong to generated acceptance fixtures. No candidate runtime, source branch or PR metadata was changed by this archive.
