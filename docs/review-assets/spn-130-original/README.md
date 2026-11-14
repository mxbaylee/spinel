# 🔎 SPN-130 original native failures

Raw JSON and Firefox driver log downloaded from desktop run
[41363063127, attempt 1](https://github.com/mxbaylee/spinel/actions/runs/41363063127)
on 2026-11-03, before artifact expiration. `SHA256SUMS` binds the unmodified files.
All application data is the job's synthetic fixture, not owner documents.

- Safari: job `125017365917`, artifact `13105558832`. Identity timed out before
  application setup; no owned identity existed for teardown.
- Firefox: job `125017365805`, artifact `13105059696`. Final deletion timed out;
  the original report cannot distinguish which storage operation was pending.

Source `7b730862e44ad286efbdcddc07adb3d8d93bd8c9`; tested merge
`59d0e2cff021599a0ca46985a0e92aa2c98aaadb`; base
`54d9db0474cd2163b8b5e51c8cfed22ddd287783`.

These are retained failures, not a diagnosed product defect, environmental cause
or a claim that SPN-130 has repaired either case. See the
[implementation record](../../implementation/SPN-130.md) for the bounded new sample.
