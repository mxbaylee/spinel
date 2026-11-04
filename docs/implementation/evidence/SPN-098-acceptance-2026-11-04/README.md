# 📨 SPN-098 acceptance evidence

## 🔎 Identities and checkpoint

The implementation candidate is `ed7ef3da5e8d57fcef4b098064a6e8eba052b1b5`
(tree `f2b1ad947a6d88129c206951c4f76b1aa3182163`), integrating main
`642eb32bb52dd7dd13b6582869ef9482910e04ec`.
Its current tested merge is `6e6d5e9ab543d9c30ba6d760dbeb7485af9ffce9`.
This evidence archive does not alter the implementation candidate.

At this checkpoint, the candidate has independent prepublication grades of
98/100 and 99/100 and independent current-source visual approval.
**Fresh current-head CI/native acceptance remains pending.** The final
[PR #227](https://github.com/mxbaylee/spinel/pull/227) description and the completed
record in this archive will identify the actual final outcome.

## 🎨 Reviewed captures

[visual-manifest.json](visual-manifest.json) identifies 18 inspected images,
their exact hashes, source/build identity, themes/viewports and artifact origins.
The five complete capture manifests report 5,380 checked/captured states and zero
capture failures; 160 are feedback states. Only the selected 18 were manually
inspected. These are production components with synthetic story data and browser
phone/tablet emulation, not physical-device or server-persistence proof.

The capture source is `066c5353b466f9371759aee52e47d169bc0d5e9a`, tested as
`4502630f58905baabbd62479c6c50fce40a6e544` in Storybook run 41861311243.
All non-documentation paths are byte-identical on the reviewed `ed7ef3da` head.
Reviewer `/root/feedback_acceptance_audit` inspected all 18 current images and
approved that unchanged source, with no blocking finding. **Agent review only.**
This is not a claim that the captures executed at the refreshed commit.

Ten images exactly match already retained assets; their manifest entries pin the
retained commit and path. Six changed PNGs and both tablet PNGs are stored under
[images/](images/). Entries marked `this-evidence-commit` resolve relative to this
archive's commit. Every retained PNG is an unedited original capture.

## 🧪 Historical execution and supersession

Files beginning `prior-` belong to source `066c5353…` / tested merge
`4502630…` / CI run 41861310743, attempt 1. They are supporting historical
evidence, not replacement gates for `ed7ef3da…`.

All four diagnostics journeys passed at retry zero in both ordinary browser
modes. Their real SQLite pairs record one preparation, two user rows and three
system rows, shared snapshot/generation/window and exclusion of later feedback.
Those browser pairs are feedback-only; the maintained real-SQLite suites own
mixed observation/unattributed-row coverage. Observer-only phone tests are
explicitly assigned to the separate native sync projects.

Main advanced during that run. Publishing the reviewed documentation-only
integration automatically canceled the unfinished mobile responsiveness worker.
The retained raw log records cancellation at 2026-11-04 16:10:09 UTC.
The old browser aggregate then correctly failed because selected responsiveness
was cancelled. Its failed result and plan digest are retained. No incomplete
mobile acceptance or failed aggregate is represented as a pass.

## 📎 Retention and limits

Original JSON is retained directly or losslessly compressed as `.json.gz`;
logs are compressed as `.log.gz`. These files preserve their actual contents,
not only hashes. Raw browser traces, callback source maps, profiles, complete
interactive Storybook builds and redundant images are supplementary Actions
artifacts unless specifically included here. Do not describe these retained
records as containing omitted raw trace bytes.

Actions retention varies: browser/callback/responsiveness artifacts and the
interactive build use 7 days; review PNG and native desktop artifacts use
14 days; coverage plans/results use 30 days. Exact artifact metadata records
the individual expiration. The actual evidence branch keeps this commit
reachable; a Markdown permalink alone is not a retention reference.

Preserve this evidence ref until its unique files are durably archived elsewhere.
Before eventual deletion, verify preservation, the current branch head and active
ownership, and use authorized ref deletion. The final PR records its exact head
and the implementation-branch cleanup separately.
