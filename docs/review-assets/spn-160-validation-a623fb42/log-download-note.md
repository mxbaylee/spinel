# 🧾 Log retrieval correction

The initial GitHub CLI log download suppressed terminal escape sequences and left two empty temporary files. Those were not test failures or acceptance receipts. Repeated read-only retrieval with the documented `--allow-escape-sequences` option writes raw bytes to files; displayed excerpts strip ANSI. No CI job was retried.
