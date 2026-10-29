# SPN-111 current application evidence

Candidate: 9a0931cf9197bbf9d3022c511298bd9974d5f9c4. Evidence-only commit; the application candidate is unchanged.

Application images come from the actual Linux-supervised production Playwright journey in run 40805811875, job 123224626476. All seven maintenance cases passed without retries; the shard passed 79 cases with zero skips, failures or flaky cases. Accounts and notice times are test fixtures. Light/dark application captures are 1280×900; phone captures are light at 390×900. Single-view native-input and pause-confirmation captures use the viewport recorded in manifest.json.

Storybook images separately depict the production archive-import component with a mocked maintenance interruption. They are design/interaction fixtures, not live application captures. Themes and exact dimensions are recorded by filename and manifest.

The manifest records source artifact IDs and verified SHA-256 archive digests, plus per-image hashes and pixel dimensions. Independent agent visual review is recorded on PR #206.
