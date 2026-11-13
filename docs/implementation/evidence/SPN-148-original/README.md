# 🖱️ Original SPN-148 Safari recurrence

This preserves the original **failed** Safari attempt from
[PR #278, run 43222001951 / job 131195571227](https://github.com/mxbaylee/spinel/actions/runs/43222001951/job/131195571227),
attempt 1. It is historical evidence, not acceptance for SPN-148.

- [safari.zip](safari.zip) is the complete unchanged artifact `13945309684`,
  1,314,764 bytes, SHA-256
  `5cbd4d880e7fc2cc2efdae7b0e5524e500de232fba5e417dd552a234b0037c76`.
  All 20 original members are retained, including all five pointer records,
  acceptance/identity/rendering/version receipts, capability probe and 15 PNGs.
- [job.log.gz](job.log.gz) preserves the connector-decoded UTF-8 job log,
  losslessly compressed. It is not a claimed original GitHub log ZIP.
- [manifest.json](manifest.json) binds the stored files and every original ZIP
  member by bytes and SHA-256; ZIP CRCs are also recorded. The original Actions
  artifact expires on 2026-11-26; these maintained bytes do not depend on it.

Source `32330c01cb26dfd19e1ee4a0ec474930d223279e`, tested merge
`c9f497530e2d8225e340e7cc1f6ade9e9ef0648e`, base
`f2e36db45a4cd10f3ff2e1358c5a3c457344856a`. Actual Safari 27.2,
macOS 15.7.9 (24G830), x64, image `20260824.0482.1`.

The fifth invocation posted a validated down/up pair after matching trusted
movement and unchanged positive target identity. No page press was observed;
observer removal and all three owned browser exits succeeded. The recovered
Doc's final native verification and storage-loss acceptance were incomplete.
The [investigation record](../../SPN-148.md#-retained-first-failure-inspection)
preserves the full interpretation and limits, including the earlier probe's
SIGTERM consent inspection and truncated OS-log retention. No cause, retry pass,
product data loss or native-journey completion is asserted.
