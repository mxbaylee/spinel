# 🔎 d93321a native first result

Exact source `d93321a16ec3194ce5aeaf44da035eae523614b7`, base
`2dc7871db0a9b7f368cda5fe260af012c70fb6b7`, tested merge
`536e8f80976e79645bf793e432574d3f1ccf1ad2`, desktop run `45048935156`, attempt 1.
Chrome and Firefox passed; Safari failed at normal Doc reconnect after publishing
an unexpected offline recovery copy. Its raw first report, version identity,
failure screenshot and compressed log are retained. There were no observed 429s
in this run. This does not dispose of the distinct first 419773ed transfer-busy
failure or prove either cause.

Both exact-d933 pre-push reviews were 100/100, not CI acceptance. Their local logs
and receipts remain exact-source evidence. The `native-fixture-observers` and
`lost-acknowledgement` logs instead cover the **subsequent working-tree fixture
repair**, not execution of d933. The implementation record states the narrow
ordering repair and attribution limits. `manifest.json` hashes retained files;
no application or diagnostics database is published.
