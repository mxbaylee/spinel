# Current restore notice and Space placement

Production-component Storybook captures, source commit
`71bd96b132412cf1d1e1da3bd259dfe381de3a30`, workflow
[41162007763](https://github.com/mxbaylee/spinel/actions/runs/41162007763),
2026-10-31. These use deterministic API fixtures and are not actual provider or
physical-device captures. The files preserve the downloaded artifact bytes.

- `*-light.png`: desktop light, artifact `13027353166`.
- `*-dark.png`: desktop dark, artifact `13027138543`.
- `*-phone.png`: mobile light, artifact `13027573858`.

Both fresh nonimplementing reviewers inspected these images on 2026-11-01 and
approved the visuals, **agent review only**. The staging repair changes no UI
component, story, style or theme; these are source-equivalent for its UI. Actual
restore-flow images in the parent directory retain their separate `280d2e72`
provenance.
