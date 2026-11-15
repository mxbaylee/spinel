# 🔌 PR #293 merge and registration cleanup

PR #293 was squash-merged at **2026-11-15 01:25:42 UTC** as `104d7ae89d3ed5ff328cc87b838ed9246f0f42ce`. Reviewed source `a2f3bac37c084b8f9fbf163d562c96dae4aff8ef`, tested merge `1d06bd9c154214035dfb2f99822002f02da59430` and actual squash all have tree `8e9d817e847e5d99ce93efef0018bff2654a52d5`. The exact merge response and confirmed merged PR snapshot are preserved unchanged. This evidence-only archive has the actual squash as its sole parent and adds files only beneath `docs/review-assets/revoked-socket-registration-completion-a2f3bac3`.

## ✅ Actual merge and cleanup

The main worktree fast-forwarded to the actual squash and was clean at the retained witness. Root checked active PR head/base ownership and exact ref heads before deleting the obsolete registration local branch and origin tracking ref. The remote branch was already absent after GitHub's squash; no remote deletion was performed. No branch configuration was present to remove. The registration worktree remains clean and detached at the reviewed source.

All obsolete refs created for this registration are absent: `refs/heads/codex/register-revoked-socket-closure` and `refs/remotes/origin/codex/register-revoked-socket-closure`; remote absence is separately reverified. Unique allocation/registration history remains reachable from the published, remote-verified [review archive](https://github.com/mxbaylee/spinel/tree/6ce3cf31f64f2f1bcfc28976582a35415a56dbb8/docs/review-assets/revoked-socket-registration-review-a2f3bac3) and [validation archive](https://github.com/mxbaylee/spinel/tree/5e1e0cd721c60993d7f451efda07c572b1d88f58/docs/review-assets/revoked-socket-registration-a2f3bac3). Their tags and source ancestry are bound in the witness. No unrelated refs were changed; `codex/dependabot-registration` and the new SPN-161 implementation branch remain present.

The next ID is 162. Full-groom date **2026-11-14** and completed SPN-098, SPN-090, SPN-120 and SPN-123 are unchanged. Focused registration does not increment the completion count, complete SPN-161 or accept SPN-128's recovery implementation.

## 🧾 First-result and reader distinctions

Original cleanup, merge, active-PR inventory and validation audits are copied byte-exact. `original-bindings.json` maps original paths and hashes; `manifest.json` covers every payload except itself. The root's final body is retained as `pr-body-completion-draft.md`: it is a draft, not evidence that a later metadata update was published.

The first read-only completion collector overmatched the unrelated SPN-161 implementation branch because its name also contains socket-closure. It stopped without mutation. The repaired reader uses the exact registration ref identities from the creation/cleanup inventory. A second read-only assumption expected the ephemeral tested merge to exist locally; it did not. The final witness reads that exact tested-commit API response from the published validation archive and compares its tree to local source/squash. Both original TypeScript readers and their explicit dispositions remain preserved. No implementation ref was deleted and no Git fetch/ref mutation was used to repair either reader.

## ⏳ Separate main validation

At the retained post-merge GET snapshot, original main CI **43663047797**, attempt 1, had completed successfully. Main Storybook **43663047727**, attempt 1, was still in progress with no terminal conclusion. The earlier initial snapshot is also retained. These push runs are separate from the already accepted original PR validation; this archive does not wait for or claim completion of the running full Storybook work. Any later metadata-triggered validation is also separate. Root owns subsequent publication and monitoring.
