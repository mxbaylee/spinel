# Private droplet deployment (SPN-029, acceptance pending)

This package targets a fresh Ubuntu droplet with 2 GB RAM and one CPU. It has not
yet been exercised on the owner’s droplet. Do not mark SPN-029 complete until the
owner’s fresh-host run, external port scan, measured memory and update/reconnect
evidence are recorded. Editors are not present yet, so editor reconnection cannot
be demonstrated by the current scaffold.

## Topology

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
   consistent backup/sidecar handling (backup work is SPN-030).

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
Compose refuses to create missing data directories. Do not bypass preflight with
a direct `docker compose up` during deployment.

The service supervises both containers: a container exit brings down the pair and
systemd restarts through preflight. Docker restart policies are deliberately off
so an engine restart cannot bypass the encrypted-mount check. After a host reboot,
service startup remains blocked until the operator unlocks and mounts the volume.
Then its next retry starts Spinel. Stop with `systemctl stop spinel` before
unmounting or locking the volume. No deployment step removes the data directory.

## Validate and update

From the tailnet, open the configured HTTPS hostname, claim the first admin and
create a separate everyday account. Check passkey sign-in, the certificate, and
that a TLS 1.2 client fails while TLS 1.3 succeeds. `ss -lntup` should show the app on
loopback and Caddy only on the Tailscale IP; investigate all other listeners.

From a machine outside the tailnet, scan the public IPv4 and IPv6 addresses:
`nmap -Pn -sT -p- ADDRESS`. Also test public UDP 443 and the Tailscale UDP listener
as applicable; no public service should answer. Record date, vantage point,
commands and results. A local scan or firewall screenshot is insufficient.

Before update, note the current image ID and take a verified backup using the
SPN-030 process once available. Build/pull the new reviewed image, update only
`SPINEL_IMAGE`, and `systemctl restart spinel`. Confirm the same data and passkeys
remain. With editors present, keep two editors open and verify reconnection and
preserved edits. Do not roll back across an incompatible schema migration without
an explicit data-restore plan; reverting an image alone cannot reverse schema.

Record `docker stats --no-stream` for app/Caddy and `free -m` on the target at idle
and with two active editors. Current caps are 512 MiB for Node and 128 MiB for Caddy;
these are caps, not measured usage or proof of headroom. Acceptance requires
measured target-host results, including total OS/Tailscale overhead.

## Remaining acceptance evidence

- Owner-supplied droplet, tailnet identity, access and encrypted volume.
- Fresh-host guide run, LUKS reboot/unlock behavior, tailnet TLS and certificate renewal.
- External public IPv4/IPv6 port scan and measured memory on the 2 GB target.
- Update with persistent data and live editor reconnection after editors exist.
