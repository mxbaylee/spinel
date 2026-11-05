# 🔎 SPN-146 changed-launcher outcome — independent review B

The single declared observation **failed its 2 GiB owned-RSS contract**. Its trace-window collection completed, but the full workload, final semantic checks and normal owned cleanup did not complete. This is neither product acceptance nor a successful diagnostic with an inconclusive analysis. The allowance is consumed and closed; no rerun, conversion or new execution is admitted by this review.

## 🧾 Identity and inspection boundary

Reviewed source `8b6828196266f1fac6c46e2cc16b16321db72cf7`, tree `0ba3793fc97fab71d7053b689c1880e17cb23a34`, before-anchor `a4eb19e4c5b95ba589042fe181cbcec2aa848990`; run `42076760192`, attempt 1, job `127418913183`. The diagnostic intentionally installed prior-native Docs from `2f442317dd2e1c188ae4a810ac094fd1162a4a2a`, not the proposed production algorithm. The build receipt binds prior Docs ES `57ec2ee153792c73e466a753d2e5c9ed1cd19615bb45a04fbe72c9336a6ad2b8` and Core ES `a019e7eb8b2ba235c7cfd54a19c262377a90c25aca13e5c2e0671a43b709e434`.

I inspected the retained small build, source-binding, progress, window, transport and resource receipts and terminal job disposition. I independently hashed the 583,101-byte CPU profile, matching `11cd1ccaa151c39d81c0f79befab5734516e8d1986812374d5217696bb9f3205`. I reconciled the retained integrity manifest rather than repeating its complete ZIP scan: artifact `13439850683`, 11,376,066 bytes, ZIP SHA-256 `f0f4987040a6825f2dde6e1cb31e12ec3b8b15c66db0979b5baeb9dc83537edc`; the existing guarded proof records all 70 members and successful CRC validation. No browser, converter, whole-trace parse or runtime replay was performed for this review.

The completed live-source binding records 30 scripts and 50,574,640 bytes. The two explicitly unmapped emitted helpers remain unmapped; this does not invent source mappings. Separate source preparation passed in 322.252 ms with 198,596 KiB peak RSS. These are completed prerequisite substeps, not acceptance of the failed observation.

## ⏱️ What the partial window actually establishes

The window receipt has `complete: true`, `traceComplete: true`, boundaries 384 and 448, and all four start/end/GC-control marks. Native pending counts were zero at the retained boundaries. The two relevant measured native phase pairs were **32.6 ms at 416** and **11.1 ms at 448**; neither meets the preregistered ≥80 ms comparable-event condition. The cheap retained boundary evidence is sufficient to establish that limitation. There is no need to convert the trace merely to search for a more favorable explanation.

The lossless transport receipt records 4,718,189 raw protobuf bytes, SHA-256 `dbdc0b629885757fc692c6939577dbe7498c6208657134fdddfe4be9e240291f`, stored as 739,025 gzip bytes, SHA-256 `15e4aeee7fd756730620193d9aa7858e00ccbcebb93ee1146be2a54510b65e00`. The stored identity agrees with the retained ZIP proof; the raw identity is the collector's receipt, not a second independent decompression performed by me. Completion reported `dataLossOccurred: false`, proto/none transport and a closed stream, without a collection failure.

This establishes completed transport, **not** independent protobuf framing/conversion/stats validation, calibrated trace attribution, proof of observed GC category coverage, absence of GC, or a cost-versus-pause explanation. The conversion step was skipped after the failed observation. Requested categories are not equivalent to validated observed categories. The retained profile likewise has an identity but no accepted sample attribution in this review.

## 🛑 Failure and cleanup limits

The journal progressed from typing to trace collection, then `window-continuation` at 22,664.287 ms and `native-drain` at 130,793.532 ms. These times are journal-relative, not interchangeable with the watchdog's elapsed clock. Its last phase was `native-drain`; terminal, first-failure and persistence-failure fields remained null. External process termination explains why an empty failure field cannot mean success.

The watchdog's **first** violating sample was 2,105,812 KiB at 146,005.339 ms, 8,660 KiB above 2 GiB; the later peak was 2,106,380 KiB. The final snapshot at 146,213.657 ms contained only the watchdog process. That is a useful witness that its known child tree was reaped, not proof that application fixture/CDP restoration or every normal cleanup step completed. Host available memory was approximately 14 GiB at the first violation; this was the declared owned-resource ceiling, not demonstrated host-wide exhaustion.

No final full metrics, complete captured native-cache publication, full content/history checks, drain-complete witness or normal terminal cleanup result is present. Reaching `native-drain` does not establish that all 2,086 inputs settled or that the complete semantic contract passed. The two largest browser processes in the first violating snapshot do not alone identify their application roles, retained-object owners or memory causes.

## 🧭 Disposition and smallest justified next work

Preserve the complete original artifact, the successful prerequisite/window substeps, and this resource failure together. The changed launcher coincides with this attempt reaching a complete window; one observation does not prove it caused that progress or guarantees Linux headroom. The historical pauses, the two component experiments' failed fixed criteria, and SPN-146's remaining production acceptance remain unresolved.

**Stop this resource-repair → same-window observation loop.** No unchanged retry, moved window, increased resource/trace budget, threshold relaxation or conversion for causal hunting is justified here. The already retained boundary measurements show no comparable slow event, while the overall observation failed before final semantics.

If work continues, the next useful step is a different, explicit retained/static question: inspect ownership and retention of diagnostic state versus ordinary application state, and whether the previously observed slow real cache shapes are represented by the proposed source-level mechanism. Existing raw captures, source and manager semantic controls can support or falsify a concrete hypothesis without another app run. The resource inventory alone cannot prove a leak or select a repair, and lower allocation counts alone cannot satisfy the missing runtime-cost distinction. Any later executable experiment would require a new discriminating question, finite prospective bounds and independent admission; this report grants none. No merge approval is given.
