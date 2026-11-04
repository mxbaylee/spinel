# 📦 Callback artifact preservation

Desktop original artifact13366167514 SHA256
`42d3a6c524db65bad1ac165f4db7c964eaa3d90b2cd9bb06431c24bb38abe9db`.
Filtered publication package SHA256
`3e2e957a4cadc14d8d0d7b6cdc13fecb1384d02e89a396f6af15bd656992fdea`.
Only disposable `*.sqlite*` fixture files are omitted. All77 retained members
were independently streamed from original and filtered ZIPs and compared by
uncompressed byte length and SHA256; see callback-desktop-members.json.
The verifier ran under the shared watchdog,1964ms/227072KiB sampled peak,
normal pressure. Inner compressed traces were not inflated by that verifier.

For the audit, seven required JSONs were extracted: two evidence, two progress,
two Playwright reports and the paired comparison. An optional manifest glob
matched no file and made unzip return11 after extracting those seven correctly;
this was not a runtime failure or a missing required artifact. Source manifests
are embedded in the retained evidence. The full package additionally retains
all declared source maps/bundles and compressed traces. The independent reviewer
verified the70 declared source/trace member hashes without inflating inner traces.
