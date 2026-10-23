# Private droplet deployment

This is the current deployment implementation and a record of the retired test
host, not a live production service. Production starts with SPN-038 at
`spinel.baylee.dev`, after the launch prerequisites. Database and hosting choices
can be reconsidered before then; see [deployment stage](development.md#deployment-stage).
Owner, chat 2026-10-21.

This package targets a fresh Ubuntu droplet with 2 GB RAM and one CPU. The owner's
fresh-host run on 2026-10-17 verified private HTTPS/SSH, locked-boot recovery,
account and document persistence, editor reconnection and measured memory use.
After removing a leftover inbound SSH rule, all 65,535 public IPv4 TCP ports were
filtered in an external scan. UDP 443/41641 did not answer probes; the ambiguity
of that result is recorded below. The owner waived external IPv6 scanning in #17;
IPv6 firewall closure was configured for that run. No external IPv6 scan pass is claimed.

## Test host retired, 2026-10-17

After acceptance, the owner requested complete teardown of the disposable test
instance and redeployment later with the public HTTPS work in SPN-038. The
DigitalOcean UI confirmed deletion of droplet `spinel` (610086510), the 10 GiB
`spinel-data` volume and unused `spinel-private` firewall. The volume remained
detached after the droplet deletion, so it was explicitly deleted separately.
The account showed no remaining Droplets, volumes, reserved IPs, Droplet backups,
Droplet snapshots or volume snapshots. The Spinel Tailscale device was removed;
the owner's Mac devices remain registered.

The deleted volume contained test accounts, documents and its local archive;
these were deliberately discarded, not backed up for restoration. The evidence
below is historical acceptance evidence, not a running-production claim. Keep
this package for a fresh deployment, allocate new resources, re-enroll accounts
and update DNS to newly assigned addresses. Never assume the old public IPs or
tailnet identity still belong to Spinel. After the owner signed in, both old
`spinel` A/AAAA records were removed from Namecheap; its filtered host table
showed no records and authoritative DNS returned NXDOMAIN. Other domain and
mail records were left intact. Cached DNS answers may persist until expiry.

## Topology

### Changing the application hostname

When the configured hostname changes, old passkeys may no longer work at the new
origin. Configure the canonical `APP_ORIGIN` and HTTPS proxy together, restart
the application with that origin, and use the server console with the same
database/environment to run `npm run setup -- --recover-admin`. Choose the
existing active admin by `--id` or exact `--name` if there is more than one.
Open the printed link at the new origin and register a new passkey. Afterward,
issue recovery invitations for existing members so they enroll on the new
hostname. Their account IDs, documents and permissions remain unchanged. Never
reset the database or rerun first-admin setup to solve a hostname lockout.
See [console recovery](setup.md#recover-an-existing-admin). Public HTTPS
redeployment timing and external acceptance remain SPN-038.

### Current private deployment

The Node container binds only `127.0.0.1:3000` on the Linux host. Caddy binds only
the machine’s Tailscale IPv4 address on TCP 443 and proxies HTTP and WebSockets to
Node. Caddy requires TLS 1.3, enables HTTP/1.1 and HTTP/2, disables automatic port 80 redirects
and disables its admin listener. There are no Compose published ports. Host
networking is deliberate so Node can bind actual loopback and Caddy can bind the
actual Tailscale interface; this configuration requires Linux, not Docker Desktop
network emulation.

Tailscale runs on the host. Caddy obtains and renews `.ts.net` certificates through
the local Tailscale socket as UID 10001; set `TS_PERMIT_CERT_UID=10001` in
`/etc/default/tailscaled`. The Caddy container has no root or Docker socket access.
Only its certificate request permission is granted. Enable MagicDNS and HTTPS
certificates in the tailnet. Do not enable Funnel or another public listener.
The hostname appears in public certificate transparency logs; document content
remains private.

Sources: [Docker host networking](https://docs.docker.com/engine/network/drivers/host/),
[Tailscale’s Caddy integration](https://tailscale.com/docs/integrations/web-servers/caddy/caddy-certificates),
[Caddy TLS configuration](https://caddyserver.com/docs/caddyfile/directives/tls).

## Prepare the host

1. Create the droplet and attach a cloud firewall. During bootstrap, permit SSH
   only from the operator’s current IP. Install Docker Engine with Compose from
   [Docker’s Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/),
   Node 24.19.0 at `/usr/local/bin/node`, and `cryptsetup`. Clone the reviewed
   repository into `/opt/spinel`; use an exact reviewed commit for builds.
2. Install Tailscale using its official Ubuntu instructions and join with an
   owner-created auth key, entered on the server without committing it. Verify
   tailnet SSH/access from a second terminal before removing the bootstrap SSH
   firewall rule. Set the certificate permission above and restart tailscaled.
3. Close every public inbound cloud-firewall rule, including IPv6. Tailscale can
   use outbound connections/relays without an open public listening port. Restrict
   tailnet ACLs to the intended people. Keep a tested provider console recovery
   path before closing public SSH. See [DigitalOcean firewall rules](https://docs.digitalocean.com/products/networking/firewalls/how-to/configure-rules/).
4. Prepare an empty LUKS2 data volume and mount it at `/srv/spinel/data`. Formatting
   a device destroys its old contents: the operator must identify the exact empty
   device and confirm it before running `cryptsetup luksFormat`, `cryptsetup open`
   and filesystem creation. No script here formats disks. Keep the unlock key
   outside the droplet and unlock/mount after a reboot. Never store the unlock
   passphrase in the repository, environment files or on the unencrypted root disk.
   Verify the mounted device’s ancestry with `lsblk` and `cryptsetup status`.
5. On that mounted volume, create `app/` owned by UID/GID 1000 and `caddy/` owned by
   UID/GID 10001, mode 0700. SQLite, WAL and shared-memory sidecars live in `app/`;
   Caddy state lives in `caddy/`. Do not move a live SQLite main file without its
   consistent backup/sidecar handling (see [offsite backups](backups.md)).

## Configure and start

Copy `deploy/deploy.env.example` to `/etc/spinel/deploy.env`, mode 0600, and fill in
the actual tailnet hostname/IP and canonical encrypted mount path. Create
`/etc/spinel/runtime.env`, mode 0600, for application secrets such as the Univer
license key when used. Do not commit or print these files. Passkey sessions use
hashed random server-side tokens and need no signing secret; never invent an
unused `SESSION_SECRET`. A future feature that needs one must read it from this
runtime environment file.

Build with `docker build -t spinel:COMMIT .`, then use
`docker image inspect --format '{{.Id}}' spinel:COMMIT` as `SPINEL_IMAGE`.
The Compose configuration requires the immutable local image ID (or a registry
reference pinned by digest). Build on a separate machine/CI for routine updates
if build-time memory competes with the small droplet; transfer/pull the exact
image and inspect its digest on the host.

Install `deploy/spinel.service` as `/etc/systemd/system/spinel.service` and run
`systemctl daemon-reload`, then `systemctl enable --now spinel`. The service loads
the deployment environment and executes the TypeScript preflight before Compose.
Preflight refuses a missing/unmounted/non-LUKS data path, wrong directory owners,
a mutable image, mismatched tailnet identity or a non-private runtime file.
Preflight also rejects nested mounts beneath the encrypted root and checks the actual
backing filesystem for both app and Caddy directories. Compose refuses to create missing data directories. Do not bypass preflight with
a direct `docker compose up` during deployment.

The service supervises both containers: a container exit brings down the pair and
systemd restarts through preflight. Docker restart policies are deliberately off
so an engine restart cannot bypass the encrypted-mount check. After a host reboot,
service startup remains blocked until the operator unlocks and mounts the volume.
Then its next retry starts Spinel. Stop with `systemctl stop spinel` before
unmounting or locking the volume. No deployment step removes the data directory.

## Validate and update

Print the first-admin setup link on the host with
`docker compose --env-file /etc/spinel/deploy.env -f deploy/compose.yaml exec app node server/setup.ts`.
Open that one-time link from the tailnet, create the admin passkey, then use Admin
to invite a separate everyday account. Check passkey sign-in, the certificate, and
that a TLS 1.2 client fails while TLS 1.3 succeeds. `ss -lntup` should show the app on
loopback and Caddy only on the Tailscale IP; investigate all other listeners.

From a machine outside the tailnet, scan the public IPv4 address:
`nmap -Pn -sT -p- IPV4`. Also test public UDP 443 and the Tailscale UDP listener
as applicable; no public service should answer. Record date, vantage point,
commands and results. A local scan or firewall screenshot is insufficient.
The owner explicitly removed external IPv6 scanning from SPN-029 acceptance on
2026-10-17 ([decision #17](https://github.com/mxbaylee/spinel/issues/17)): the
current Mac connection has no global IPv6 address or route and no alternate
vantage point is available. IPv6 firewall closure remains required; an unperformed
scan is not a passing result. No replacement IPv6-check ticket is required.

Before update, note the current image ID and take a verified backup using the
[offsite backup procedure](backups.md). Build/pull the new reviewed image, update only
`SPINEL_IMAGE`, and `systemctl restart spinel`. Confirm the same data and passkeys
remain. With editors present, keep two editors open and verify reconnection and
preserved edits. Do not roll back across an incompatible schema migration without
an explicit data-restore plan; reverting an image alone cannot reverse schema.

Record `docker stats --no-stream` for app/Caddy and `free -m` on the target at idle
and with two active editors. Current caps are 512 MiB for Node and 128 MiB for Caddy;
these are caps, not measured usage or proof of headroom. Acceptance requires
measured target-host results, including total OS/Tailscale overhead.

## Acceptance record

The required fresh-host evidence is recorded below and in
[owner check #17](https://github.com/mxbaylee/spinel/issues/17). The original
external scan requirement was revised by the owner to exclude IPv6. Private Mac
HTTPS/SSH, reboot/unlock recovery, two-editor memory and editor recovery passed.
The independent reviewer accepted the combined version-update and later
editor-restart evidence. Automatic certificate renewal is configured; forced
renewal and simultaneous Proton/Tailscale use are not additional SPN-029 criteria.

Local preparation on 2026-10-17 passed Docker build, Caddy configuration validation,
container access checks and SQLite persistence across container restart. An idle
app-only Docker Desktop sample was 148.3 MiB; this does not establish memory use
on the target. [Decision #16](https://github.com/mxbaylee/spinel/issues/16) records
the proposed startup gate. [Owner check #17](https://github.com/mxbaylee/spinel/issues/17)
records the owner input and live evidence.

### Initial target-host run, 2026-10-17

Ubuntu 24.04.5 amd64, 1 CPU, 1967 MiB RAM, no swap, and a separate 10 GiB volume.
The owner created and unlocked LUKS2 interactively; the passphrase was not supplied
to the agent or saved on the host. Ext4 is mounted at the configured encrypted root.
Docker 29.9.1, Compose 5.6.0, Tailscale 1.104.1 and Node 24.19.0 are installed.
The Node archive checksum was verified and Docker's test container passed.

An amd64 image built from e58be54 was transferred to the host. The imported local
image ID is `sha256:0b4c903fa3f997444d70f931f0f7202d135a86ee87d2dcd0a9361e8aed899952`;
its architecture and filesystem layer digests match the build. Always inspect the
image ID on the destination after transfer: Docker's image stores can report a
different top-level digest for the imported image.

The first Compose startup found unquoted commas splitting tmpfs options into
separate YAML list entries. Both entries are now quoted. Normalized Compose
configuration shows one tmpfs entry per service, and actual startup passed.
Preflight passed and systemd runs both containers. A host-side curl returned
HTTP 200 from the sign-in page with certificate verification and TLS 1.3; a
TLS-1.2-only request was rejected. Socket inspection showed Node only on loopback
port 3000 and Caddy only on the Tailscale IPv4 address port 443.

Idle `docker stats --no-stream`: Node 44.08 MiB, Caddy 9.684 MiB. Host `free -m`:
515 MiB used and 1452 MiB available. These are one idle sample, not the required
two-editor load result. Public SSH remains available during bootstrap. Private
client connectivity, cloud-firewall closure, external IPv4/IPv6 scans,
renewal and live editor checks were pending at that point. The owner subsequently
confirmed first-admin setup, an invitation and invited-user sign-in succeeded.

### Editor image update and locked reboot, 2026-10-17

An amd64 image built from d5fa3cc (including merged SPN-007) was imported and
activated as `sha256:76645e34c35d138f4afeb8107f42357b856a799df811c17fea092103fa10940b`.
Before activation, Spinel was stopped and its complete app directory copied into
`backups/before-editors-20261017T230934Z.tar` on the encrypted volume with private
permissions. Archive listing passed; this is not a tested restore or a substitute
for SPN-030. Preflight/startup and certificate-verified HTTPS returned successfully.
Counts remained two users and two passkeys, and the sheet snapshot table exists.
No document contents were inspected. Live editor continuity was not yet verified
at that point; the later restart check is recorded below.

With the owner's explicit readiness and passphrase available, the host rebooted.
The boot ID changed from `5c086f12-6cc2-4716-8219-379d8781a1c1` to
`7d84c749-aac6-4f67-a7da-32356a6f7da5`. The volume remained `crypto_LUKS`, with no
mapper device or mounted data root. No Docker containers ran. Systemd retried,
and preflight refused startup because the encrypted mount was absent. The owner
then unlocked the mapping interactively. After mounting it, systemd's next retry
started both containers automatically at 23:14:36 UTC, without a manual service
restart. Certificate-verified HTTPS returned 200. SQLite `quick_check` returned
`ok`; both users and both passkeys remained. There were no workspace items or
sheet snapshots yet, so this does not establish document persistence.

The post-recovery idle sample was Node 110.2 MiB, Caddy 51.47 MiB; host memory was
439 MiB used and 1528 MiB available. The later two-editor sample is below.

For this host, after each reboot, run each command separately in the SSH terminal.
The first prompts for the owner-held passphrase; the second mounts the unlocked
filesystem. Neither formats the volume:

```bash
cryptsetup open /dev/disk/by-id/scsi-0DO_Volume_spinel-data spinel-data
```

```bash
mount /dev/mapper/spinel-data /srv/spinel/data
```

Allow up to 30 seconds for the service's next retry, then check
`systemctl is-active spinel`. If either command fails, inspect the error before
continuing; never repeat the initial formatting step to fix an unlock failure.

After recovery, a Mac-side request to the tailnet hostname returned verified
HTTPS 200. SSH to `100.95.139.63` also succeeded using the already-trusted public
host key (`HostKeyAlias=147.182.177.128`) and returned the new boot ID. At this
check Tailscale was connected and Proton was disconnected. This verifies private
management access in that configuration, not simultaneous VPN compatibility.

### Two editors and restart persistence, 2026-10-17

The owner opened two test spreadsheets in separate tabs, entered values and
confirmed both were open after being asked to wait for saved status. Read-only
metadata confirmed two snapshots at revisions `[2, 2]`, totaling 2154 bytes.
Node used 116.4 MiB and Caddy 52.46 MiB; host memory was 458 MiB used and 1509 MiB
available, with no swap. This is a small two-editor sample, not a large-workbook
stress test or a co-editing test.

With those tabs left open, `systemctl restart spinel` exercised stop/preflight/start.
Certificate-verified HTTPS returned 200 afterward. The SHA-256 of sorted snapshot
rows (IDs, native snapshots, revisions and write IDs) was identical before and
after: `04a98583dcfdec2bc4a3eab443a64e805f4e5476395420331fb75ebd603de382`.
SQLite `quick_check` passed. The owner was then asked to edit both existing tabs
without reloading, wait for Saved, and reload to check the new values; they
reported "No error". Read-only metadata subsequently showed revisions `[3, 4]`.

The actual version update preceded creation of these sheets. This later check
used the same immutable image on both sides of the restart; it verifies document
persistence and open-editor recovery through the deployment restart mechanism,
not an additional cross-version editing test.

### Firewall closure and scan scope, 2026-10-17

The owner confirmed a working DigitalOcean Recovery Console shell, then reported
attaching `spinel-private` with no inbound rules and the default outbound TCP,
UDP and ICMP rules for IPv4 and IPv6. The agent did not independently inspect the
provider firewall configuration. Private SSH to `100.95.139.63` and verified
HTTPS to the tailnet hostname succeeded afterward; the owner also confirmed SSH
worked after an initial timeout.

A full TCP scan of `147.182.177.128` from the Mac's public Wi-Fi route ran with
`nmap -Pn -sT -p- --reason -T4 --max-retries 2 --min-rate 200 --max-rate 500 --host-timeout 15m`.
It stopped at the host timeout after 900.58 seconds, so it is incomplete and does
not establish that all public TCP ports are filtered. A UDP scan could not start
without local elevated privileges. Neither is recorded as a pass.

The owner then requested: "Let's just skip ipv6 check for now and remove it from
the todo." This explicitly revises the earlier dual-stack scan requirement in
this guide and #17. The Operator can proceed without another IPv6-capable machine;
the Owner and Collaborator keep the same private deployment and data protection;
the Link guest's access boundaries are unchanged. The tradeoff is absent external
IPv6 verification, accepted by the owner. IPv6 configuration and firewall rules
are unchanged. No IPv6 scan success is claimed.

A subsequent targeted public IPv4 scan at 16:45 PDT used
`nmap -Pn -sT -p 22,80,443,3000 --reason --max-retries 1 --initial-rtt-timeout 250ms --max-rtt-timeout 750ms --host-timeout 15s 147.182.177.128`.
TCP 22 was **open** (`syn-ack`); 80, 443 and 3000 were `filtered` (`no-response`).
The firewall report therefore does not yet establish private management access;
public SSH closure remains a blocker. The owner is checking inbound rules,
attached droplets and any additional/tag-applied firewall rules.

The owner supplied an external UDP result at 16:43 PDT from the Mac:
`sudo nmap -Pn -sU -p 443,41641 --reason --max-retries 2 --host-timeout 60s 147.182.177.128`.
Both ports were `open|filtered` with `no-response`; the scan completed in 3.64
seconds. Neither answered the probes, but this result cannot distinguish a
filtered port from a silent service. Host listener inspection showed no UDP 443
listener and Tailscale on UDP 41641. This is limited UDP evidence, not a claim
that those ports were conclusively proven closed.

The owner then found and deleted the only inbound rule, SSH TCP 22, retaining the
three outbound rules. A fresh targeted scan at 16:48 PDT used the same TCP command
above with `--max-retries 2`. Ports 22, 80, 443 and 3000 were all `filtered`
(`no-response`), completed in 2.10 seconds. Private SSH subsequently confirmed
`systemctl is-active spinel` returned `active`, and private verified HTTPS returned
200. The full TCP retry started before the correction was interrupted; the post-correction connect scan also stalled and was interrupted. The owner
has been given a privileged SYN scan command to complete the full IPv4 check.
No full-port result is claimed yet.

### Completed full IPv4 scan, 2026-10-17

The owner ran the following privileged SYN scan from the Mac's external public
connection after removing the inbound SSH rule:

```bash
sudo nmap -Pn -sS -p- --reason --max-retries 1 --min-rate 1000 --max-rate 2000 --host-timeout 5m 147.182.177.128
```

Nmap 7.992 started at 16:55 PDT and completed in 132.66 seconds. It reported all
65,535 TCP ports as `filtered` with `no-response`, with none open. This is the
completed full scan; earlier timed-out/interrupted connect scans are not treated
as passes. Together with private SSH/HTTPS after firewall correction, the owner
firewall confirmation and the limited UDP result above, this completes the
external IPv4 evidence. Results describe this tested configuration and time.

The deployment retains the remaining SPN-029 rules: immutable images, systemd
supervision through private-network/LUKS preflight, loopback app and tailnet-only
TLS 1.3 proxy, environment-supplied secrets, measured headroom on the 2 GB host,
and TypeScript-only deployment/maintenance scripts. The original PostgreSQL
storage plan was replaced with encrypted SQLite by owner decision on 2026-10-17.
The [offsite backup procedure](backups.md) covers SPN-030; diagnostics remain SPN-032. Public-domain deployment is
SPN-038 and does not change this tested private configuration.
