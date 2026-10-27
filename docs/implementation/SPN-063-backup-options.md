# SPN-063: backup options, deployment configuration and assisted restore

**Recorded:** 2026-10-27. **Status:** proposed design following the owner's
follow-up: manual admin downloads, automatic S3/DigitalOcean destinations,
per-database retention/backup settings, UI restore and scheduled maintenance
messaging. The [SQLite decision](SPN-063.md#accepted-decision-keep-sqlite-without-database-adapters)
remains accepted. This discussion permits a narrow **backup-destination** boundary;
it does not reopen database-engine adapters.

**Recommendation:** one SQLite application dataset and one encrypted recovery
format; manual download available alongside optional automatic offsite backups;
separate disposable diagnostics retention; and a staged, supervised restore
operation. Deployment configuration owns storage credentials and policy. The UI
shows effective configuration and starts bounded actions. Implement assisted live
restore only after the isolated verifier and maintenance/restart lifecycle work.

These are proposed capabilities, not shipped controls. They do not complete
SPN-063 or silently add every feature below to its original weekly-verification
acceptance. The main record contains the persona decision and implementation
staging; this appendix makes the owner's proposed operating model reviewable.

## What already exists

Audit baseline:
[`a9893ce3c72d0a707f97e4444f9b3f48a65dd226`](https://github.com/mxbaylee/spinel/commit/a9893ce3c72d0a707f97e4444f9b3f48a65dd226).

| Area | Current behavior | Proposed extension |
| --- | --- | --- |
| Workspace archive | [Archive code](../../src/server/backup/archive.ts) makes a consistent full SQLite copy, adds recovery metadata, compresses and authenticates/encrypts it. | Reuse one versioned bundle for manual and automatic recovery; add the main plan's complete inventory and semantic verification. |
| Automatic backup | [Service](../../src/server/backup/service.ts) schedules 02:00 UTC, retries failed attempts hourly, uses a database lease and records status. | Validated deployment schedule/policy; shared job coordination with manual export, verification and maintenance. |
| Remote storage | [RemoteStore/SpacesStore](../../src/server/backup/spaces.ts) has a small put/list/remove test seam; production hardcodes a DigitalOcean endpoint/signing configuration. The concrete Spaces class also downloads. | One tested S3-compatible destination implementation with provider presets and a common streaming download operation. No database abstraction. |
| Workspace admin UI | [App route](../../server/app.ts) and [BackupStatus](../../web/BackupStatus.tsx) expose status only. | Manual create/download, backup catalog and isolated verification first; assisted restore later. |
| Command line | [Backup CLI](../../scripts/deploy/backup.ts) can create keys, run/list/download backups and restore into a new directory. | Preserve independent cold-host recovery and reuse the same verified operation implementations. |
| Diagnostics | Separate bounded SQLite file; existing manual snapshot download and truncate in [routes](../../src/server/diagnostics/routes.ts). | Optional seven-day event expiry, retaining current byte/queue bounds. Automatic diagnostics backup stays off by default. |
| Live restore and maintenance | No admin whole-instance restore, edit-pause/unpause or scheduled-maintenance controller. | Explicit restart-safe lifecycle; no live-file replacement by an ordinary request handler. |

## Configure recoverable datasets, not arbitrary tables or paths

The deployment can expose fixed names that map to known internal stores:

| Dataset | Contents and default policy | Restore behavior |
| --- | --- | --- |
| **Workspace** | Accounts/passkeys/grants, Sheets/Docs, native Space structure, images, history, generations, accepted edits and retry/restore receipts, plus required recovery configuration. Manual encrypted download on; automatic offsite backup enabled when configured. | Restore the coherent application dataset. Do not restore document tables independently of their authority/history/receipt state. |
| **Diagnostics** | Metrics, logs and operational events in the existing separate file. Propose **seven-day live-event retention**, manual inspection/export available, automatic backup **off**. Existing byte limits still apply. | Not required for workspace recovery. Preserve useful incident evidence separately; normally start fresh after workspace recovery. |
| **Recovery control state** | Minimal operation journal, maintenance gate, active dataset generation and recovery authorization owned by the deployment, outside both stores above. | Must survive replacing the workspace and losing diagnostics. Not a general third application database or an operator-selectable backup plugin. |

“Documents” is a useful UI concept, but today it is not a separate recoverable
database. Splitting those tables would introduce consistency problems and more
operating work. The registry should be a fixed supported dataset mapping, not a
way for a web request to supply a filesystem path, database URL or SQL query.

### Three independent retention policies

1. **Live-data expiry:** seven days for diagnostic events, measured by trusted
   server receipt time. Run bounded cleanup and report failures. Keep byte limits
   too; a busy instance can drop observations before seven days. This is a maximum
   retention target, not guaranteed completeness. The current implementation has
   **no age-based deletion**, as [diagnostics](../diagnostics.md) documents.
2. **Recovery-point retention:** how long complete workspace backups survive.
   Preserve the current starting policy: newest point in each of seven UTC days,
   four Monday-based weeks and six calendar months, plus its existing safety
   holds. This is not a count of 17 distinct backups. Seven-day metrics expiry
   must not delete old workspace recovery points.
3. **Application history/trash policy:** checkpoint and deletion recovery inside
   the workspace. Backup retention does not prune that content. Its existing
   rules remain independent.

Deleting diagnostics rows does not erase old downloads, offsite copies or every
allocated disk page. If diagnostics backup is enabled later, give it an explicit
short archive policy and disclose that older exports persist independently.
Do not apply a new metrics TTL indiscriminately to future submitted feedback
(SPN-098); decide that data's retention separately.

## A deployment configuration shape

This **illustrative schema is not accepted by today's loader**. Names and
validation can be finalized during implementation. It separates policy from
destination credentials and supports manual plus automatic operation together:

```yaml
recovery:
  version: 1
  encryption:
    active_key_id: workspace-2026-01
    key_file: /run/secrets/spinel-backup.key
  datasets:
    workspace:
      manual_download: true
      automatic:
        enabled: true
        destination: primary
        schedule:
          at: "02:00"
          time_zone: Etc/UTC
      backup_retention:
        daily: 7
        weekly: 4
        monthly: 6
      verification:
        weekly: true
    diagnostics:
      data_retention_days: 7
      manual_download: true
      automatic:
        enabled: false
  destinations:
    primary:
      type: s3
      provider: digitalocean-spaces
      endpoint: https://nyc3.digitaloceanspaces.com
      signing_region: us-east-1
      bucket: example-private-spinel-backups
      prefix: example-instance/workspace
      credentials_file: /run/secrets/spinel-object-store.json
```

The example keeps today's UTC backup time and workspace retention. Those are
starting defaults, not newly demonstrated recovery guarantees. Proposed automatic
diagnostics opt-in would require a destination, schedule and explicit independent
backup retention; omitting them must fail validation rather than inherit long
workspace retention. Weekly verification applies to published recoverable
artifacts and reports blocked/missing configuration honestly.

For AWS, use an AWS preset with its actual signing region and SDK endpoint
resolution. For other S3-compatible services, require a reviewed trusted endpoint
and tested capability profile. Start with one automatic destination per dataset;
multiple simultaneous destinations add partial-success, retention and rotation
semantics that the initial product does not need.

Keep secret values out of checked-in examples, browser responses and logs.
Deployment supplies private mounted files or a supported credential provider.
Record a nonsecret key identifier and preserve old-key access for retained
archives. The decryption key must be recoverable independently of the host and
must not travel beside the bundle in the same download.

Use one source of truth: deployment policy is authoritative; the UI displays its
effective safe values and configuration errors. The first UI need not write back
deployment files. Separate recorded recovery metadata from live deployment
configuration: uploading an old bundle must not overwrite current endpoints,
credentials, maintenance controls or schedules automatically.

Manual-only operation can be useful for development/export, but it does not meet
the existing [offsite-before-daily-use requirement](../backups.md#current-sqlite-and-spaces-implementation)
unless an independent offsite recovery process is actually established. A green
manual download means browser handoff, not proof that someone retained the file.

## One S3 destination implementation, with compatibility tests

The useful adapter boundary is transport: publish an immutable encrypted bundle,
list completed points, stream a selected point, and delete eligible points.
Artifact creation, encryption, inventory, retention policy and semantic checks
remain shared concrete SQLite recovery code. The current `RemoteStore` is a
starting point; extend it only for the operations the supported flow needs.

S3-compatible does not mean identical behavior. Current `SpacesStore` explicitly
sends `ACL: private`; new AWS S3 buckets default to bucket-owner-enforced ACLs
disabled, which rejects unsupported ACL values. AWS's
[Object Ownership reference](https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html)
supports omitting the ACL header for that configuration. DigitalOcean documents
[partial S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/),
including differences in copy, lifecycle and encryption support. Simply changing
the endpoint is not sufficient validation.

Prove each advertised preset's signing/endpoint/addressing, private access,
streaming upload/download, interrupted-upload cleanup, checksum/readback,
pagination, publication and deletion behavior. Respect the current 5 GiB upload
cap until bounded multipart upload/abort is implemented and tested. An ETag is
not a generic SHA-256/content-proof contract. Continue application-controlled
authenticated encryption; provider encryption at rest serves a different purpose.

List only complete published points in the restore picker. Verify selected bytes
against their authenticated manifest and enforce instance/dataset identity. A
foreign-instance archive requires an explicit supported import/recovery workflow;
silently mixing it into the current timeline is unsafe. Hold a point during
download/verification/restore and retain failed points for bounded inspection.
Versioning, object lock and provider lifecycle rules need explicit policy because
deleting a current object may leave historical versions or be disallowed.

## Manual downloads and automatic jobs share one recovery format

**Download workspace backup** should create the same encrypted `.spinel` recovery
bundle used offsite. It must work without cloud credentials once local key/image/
recovery-configuration prerequisites are met. Decouple local artifact creation
from remote publication; today's `BackupService.run()` requires remote config.

Do not copy the live `.sqlite` file directly: committed state can remain in WAL,
as the [experiment](SPN-063-experiments.md#1-an-apparently-healthy-raw-copy-can-omit-committed-work)
demonstrates. SQLite supports consistent
[online backups and VACUUM INTO](https://www.sqlite.org/backup.html). Routine
backups therefore need not require a site-wide maintenance window, although the
current synchronous copy can cause foreground pauses that must be measured.
Do not keep edits paused through compression, upload or a slow browser download.

Run long jobs outside the HTTP request lifetime, with bounded staging and visible
progress/cancellation. Stream downloads and uploads; do not hold multi-GiB files
in browser `response.blob()` or server memory. The existing diagnostics download
is small and has different constraints; reusing that browser buffering approach
would be inappropriate for full workspace archives. Use authenticated,
short-lived download authorization, no-store responses and redacted job status.
Recheck access before delivery. Cleanup must handle disconnect, expiry and restart.

Manual and scheduled backups use the same exclusive job/resource coordination.
If one is already running, expose that job or queue a bounded request instead of
creating competing snapshots. Distinguish snapshot time, upload completion,
last verified recovery time and manual browser handoff. A failed new job keeps
the last good result visible.

The Operator's application role still cannot browse documents. A workspace
download must remain encrypted, and the UI must not offer archive decryption or
content preview. Infrastructure access or possession of both archive and key
already permits reading contents; the design must not imply cryptographic
exclusion from that actor. Require fresh Operator authentication for sensitive
export/restore actions and log only nonsecret operation evidence.

## Assisted restore is a supervised maintenance operation

Use two inputs to one preparation flow: **choose a configured backup** or
**upload a previously downloaded Spinel bundle**. Automatic backup is not a
prerequisite for upload-based restore. Arbitrary bare SQLite files lack the
authenticated recovery inventory/configuration; keep them out of the ordinary
UI flow. An advanced offline repair/import path would need its own documented
validation rather than silently pretending such a file is a complete bundle.

The preparation screen should show the dataset, source instance, snapshot time,
application/schema compatibility, verification coverage, estimated resources and
the acknowledged work that will be discarded after that point. Stage/download,
authenticate, inspect and verify in isolation **before pausing edits**. Missing
keys, incompatible versions or insufficient disk should block at this stage.

```mermaid
flowchart TD
    A["Prepare and verify candidate"] --> B["Pause edits and drain accepted work"]
    B --> C["Preserve current recovery point"]
    C --> D["Stop app and activate candidate"]
    D --> E{"Recovery and health checks pass?"}
    E -->|Yes| F["Reauthenticate and resume"]
    E -->|No| G["Keep maintenance and recover original"]
```

An actual cutover needs all of the following:

- **Explicit current authority and intent.** Reauthenticate the current Operator
  and confirm the exact artifact, target instance and rollback consequence. Use
  CSRF/origin protection, single-use authorization and idempotent job IDs. Do not
  derive authorization from credentials contained in the candidate backup.
- **Server-enforced pause and drain.** Stop new mutations at HTTP, sync and job
  boundaries, allow already accepted work to finish, then fence retries. Pause
  document/history/trash, invitations/access changes and other workspace writers.
  Drain to a bounded deadline; fail safely if that cannot be established.
- **A current rollback point.** Preserve the complete pre-restore dataset and
  required configuration before destructive activation; plan space for current,
  candidate, rollback and staging/WAL. If the current dataset is already broken,
  preserve available evidence and surface that rollback cannot be guaranteed.
- **External recovery control.** Authentication, ordinary leases and backup status
  live inside the database being replaced. Keep a narrow deployment-owned
  maintenance gate and durable operation journal outside it and outside
  diagnostics. A trusted supervisor carries the operation across app shutdown
  and restart. A scoped recovery authorization must survive only that operation;
  preserve a separate cold-host credential/CLI path if normal auth is unavailable.
- **Closed handles and crash-safe activation.** Stop every app/worker using the
  live dataset before replacement, including WAL owners. Activate a complete
  candidate generation with a filesystem procedure proved on the supported
  deployment; never rename just the main file while old handles/sidecars remain.
  Persist enough progress to recover a crash at each transition. Start the
  compatible pinned app under maintenance, with jobs still gated.
- **Safe reentry.** Apply the main plan's recovery epoch, revocation reconciliation
  and session/retry fencing. Old browsers and offline queues must not silently
  replay newer work over a restored timeline. Verify critical read/edit/deny
  behavior with isolated fixtures, require current recovery authority to resume,
  and retain the previous generation for a bounded rollback period.

Do not build this by giving the normal web app an unrestricted Docker socket or
shell-command API. The supervisor's allowed operations, paths and generation
identifiers must be narrow and validated. If the deployment cannot yet provide
that control path, the UI can prepare/verify a restore and offer the existing
offline activation instructions. It must not claim live replacement is available.

After an interruption, prefer visible maintenance to silently reopening an
unknown database generation. A failed candidate can return to the preserved
original only through the same verified activation procedure. Once users have
resumed and written new work, a later rollback is another explicit restore with
potential loss; it is no longer a harmless automatic undo.

## Pause, resume and scheduled notices

Expose application terms: **Pause edits**, **Resume**, and **Restore workspace**.
Avoid a generic “lock database” control backed by a long SQL transaction. An edit
pause and the encrypted volume's unlock are different operations; the UI should
not merge them.

A scheduled notice can say “Maintenance Friday at 8:00 PM Pacific” with a full
date, duration estimate and local-time equivalent. Store the selected absolute
instant and IANA zone, for example `America/Los_Angeles`, so daylight-saving
changes are handled deliberately. A recurring local schedule needs an explicit
policy for missing/repeated local times and missed jobs after downtime.

Keep **notice**, **pause schedule**, and **restore authorization** distinct:
publishing a banner must not authorize a destructive restore. Default to an
announced window with an Operator-initiated restore. Make cancellation and the
current job state visible; late or failed work must not disappear when the
advertised end time passes. No email/SMS notification system is required for
this first in-app capability.

Before the pause, connected people should see the planned time and whether their
edits are acknowledged. During it, reconnecting clients receive authoritative
maintenance status; offline edits remain clearly local and are reconciled with
the new epoch after restoration. Do not promise that all offline devices received
the banner. If the app stops, a minimal proxy/maintenance response must remain
available independently of its SQLite file, without exposing private job details.

## Recommended sequence and acceptance

1. **Configuration and exports:** fixed datasets, secret references, manual
   encrypted workspace download, one S3-compatible transport with tested Spaces
   and AWS presets, seven-day diagnostics expiry as a separately bounded change.
2. **Repeatable isolated verification:** complete SPN-063's original integrity,
   semantic, resource, rotation and last-success/failure acceptance. Verification
   never activates the recovered dataset or its archived jobs.
3. **Maintenance controls:** server-enforced pause/drain, external durable journal,
   restart recovery, safe client messaging and proxy status. Prove failure at
   every transition before enabling live replacement.
4. **Assisted restore:** remote picker and manual upload feed the same verified
   candidate flow, controlled activation, authority reconciliation and rollback.
   Scheduled notices can accompany this stage; unattended scheduled restore is
   unnecessary for the initial design.

Each increment needs its own concrete implementation scope when work starts.
The current preparation changes documentation only; no runtime configuration
schema, destination, expiry job, UI action or maintenance controller is installed.

Acceptance must cover both manual-only and automatic configurations; wrong/old
keys; private AWS/Spaces access; interrupted transfer and bounded staging;
retention holds; double-click/retry/cancel; Operator access expiry; concurrent
edits and offline reconnect; auth-database replacement; restart or host loss at
each cutover step; unavailable image/key; failed checks and rollback; and current
light/dark/phone review for the implemented screens. Preserve the independent
command-line fresh-host drill: an in-app restore button is unavailable when the
host or application itself is gone.
