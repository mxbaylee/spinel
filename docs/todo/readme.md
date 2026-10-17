# Functional Requirements Document (PRD): Spinel Workspace

**Project Name:** Spinel  
**Target Deployment:** Self-hosted personal cloud on DigitalOcean Droplet (2 GB RAM, Ubuntu)  
**Primary Engine:** Open-source Univer SDK (`@univerjs/core` and plugins)  
**Primary Users:** ~2 concurrent users (Personal / Invitation-Only)

---

## 1. Product Identity & Branding

* **Identity & Mascot:** Inspired by *Steven Universe*’s Spinel.
* **Persona-Based Theme Engine:**
  * **Light Mode ("Vintage / Pre-Injector"):** Coral pink, warm magenta, light rose backgrounds, and soft cartoon-inspired contrast borders.
  * **Dark Mode ("Modern / Refined"):** Deep cosmic purple (`#1A1225`), vibrant cyber-magenta highlights (`#FF2A85`), dark charcoal panel backgrounds (`#120D1A`), and muted lavender text.
* **UI Branding:** Custom logo mark, favicon, and empty-state illustrations reflecting Spinel's persona.

---

## 2. First-Class Dashboard & Document Management System

The document management system serves as the primary landing interface upon authentication.

### 2.1 File System Hierarchy & Folder Structure
* **Nested Folders:** Arbitrary nesting depth for document organization (`/Personal/Finance/2026`).
* **Tags System:** Multi-tag association per document (e.g., `#budget`, `#journal`, `#recipes`).
* **Favorites & Pinned:** One-click pinning of active daily drivers to the main sidebar for instant access.
* **Trash & Soft Delete:** 30-day soft-delete retention before permanent purge.

### 2.2 Search & Filtering
* **Dashboard Search Bar:** Real-time client-side and server-side filtering by title, folder path, or tags.
* **Filter Views:** Filter by document type (Sheets, Docs, Slides), ownership, tag, or last modified date.

### 2.3 User & Invitation Management UI
* **Admin Control Panel:** Dedicated dashboard section visible to the instance owner.
* **Invite Token Generator:** Create single-use or time-bound invitation tokens/links (`/invite?token=...`).
* **User Overview:** List registered users, active Passkey devices, and permission roles.

---

## 3. Core Editor & Collaboration Engine

* **Unified Canvas Workspace:** Single-window runtime hosting Spreadsheets (Sheets), Rich Text Documents (Docs), and Presentations (Slides) powered by Univer SDK.
* **Cross-Document Data Embedding:** Embed live spreadsheet grids directly into documents and slide decks.
* **Real-Time Multi-User Co-Editing:** WebSocket mutation relay with Operational Transformation (OT).
* **Live Presence Indicators:** Real-time multi-user cursor tracking, active cell selection highlights, user avatars, and session presences.

---

## 4. Authentication & Access Control

* **By-Invitation-Only Onboarding:** Registration route blocked without a valid invite token in the database.
* **Passkey-First Authentication:** Passwordless WebAuthn/FIDO2 flow via `@simplewebauthn` for registration and login.
* **Session Security:** HTTP-only, `SameSite=Strict` session cookies or signed JWTs.
* **Granular Sharing Matrix:**
  * **Private:** Default state, restricted to document creator.
  * **Specific Users:** Explicit user-level read/write permissions based on internal user IDs.
  * **Anyone with URL:** Tokenized secret link sharing configurable for either view-only or public edit access.
* **WebSocket Handshake Gatekeeper:** Authenticates session cookies and verifies user role prior to upgrading WS connection; drops edit mutations from view-only connections.

---

## 5. History Decay & Restoration Strategy

* **Sliding Time-Decay Schedule:**
  * **0 to 60 Minutes:** High-precision snapshots every **5 minutes** (or major idle breaks).
  * **1 to 24 Hours:** Step down to **30-minute** and **60-minute** checkpoints.
  * **Beyond Today:** Transition to **1 daily checkpoint** (end-of-day final snapshot).
  * **Pinned / Named Versions:** Explicit user checkpoints (e.g., *"Q3 Final Lock"*) marked `is_pinned = true` and exempt from automated pruning.
* **Dual History UI:**
  * **For Today:** Granular timeline/slider view to scrub through intraday changes.
  * **For Past History:** Calendar picker view displaying highlighted dates with available daily checkpoints.
* **Preview & Rollback:** Loading historical snapshots into a read-only preview canvas with one-click restoration to overwrite active document state.

---

## 6. Mobile Experience (PWA Strategy)

* **Progressive Web App (PWA):** Configured with Web App Manifest (`manifest.json`) and lightweight service worker for full-screen "Add to Home Screen" usage.
* **Mobile Touch Engine:** Native canvas pinch-to-zoom, pan, touch selection handles, and touch-optimized toolbars provided by Univer's canvas renderer.
* **Private Network Access:** Full mobile operation through local Tailscale client connection to the private DigitalOcean server instance.

---

## 7. Security & Infrastructure Architecture

* **Encryption at Rest:** Storage-level disk/database encryption (LUKS / PostgreSQL TDE) protecting stored snapshots, user credentials, and session tables.
* **Transport Encryption:** TLS 1.3 enforced across all HTTPS REST endpoints and WSS WebSocket connections.
* **Network-Level Isolation:** Application bound locally (`127.0.0.1`) and exposed strictly over Tailscale VPN or reverse-proxied through Caddy/Nginx.
* **Low-Resource Footprint:** Docker Compose bundle (`spinel-web`, `spinel-backend`, `postgres`) optimized for a $12/month DigitalOcean Droplet (2 GB RAM, 1 vCPU).

---

## 8. Database Schema Blueprint (PostgreSQL)

```sql
-- Users & Auth
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE passkey_credentials (
    id VARCHAR(512) PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    public_key BYTEA NOT NULL,
    counter BIGINT NOT NULL,
    device_type VARCHAR(32),
    backed_up BOOLEAN DEFAULT FALSE,
    transports VARCHAR(255)[]
);

CREATE TABLE invite_tokens (
    token VARCHAR(128) PRIMARY KEY,
    created_by UUID REFERENCES users(id),
    used_by UUID REFERENCES users(id),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Folders & Documents
CREATE TABLE folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    doc_type VARCHAR(32) NOT NULL, -- 'sheet', 'doc', 'slide'
    folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    sharing_mode VARCHAR(32) DEFAULT 'private', -- 'private', 'users', 'public_url'
    public_share_token VARCHAR(128) UNIQUE,
    public_allow_edit BOOLEAN DEFAULT FALSE,
    is_trashed BOOLEAN DEFAULT FALSE,
    trashed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE document_tags (
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    tag_name VARCHAR(64) NOT NULL,
    PRIMARY KEY (document_id, tag_name)
);

CREATE TABLE document_permissions (
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL, -- 'viewer', 'editor'
    PRIMARY KEY (document_id, user_id)
);

-- Snapshots & Decay History
CREATE TABLE document_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    snapshot_json JSONB NOT NULL,
    created_by UUID REFERENCES users(id),
    is_pinned BOOLEAN DEFAULT FALSE,
    pinned_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_snapshots_doc_time ON document_snapshots(document_id, created_at DESC);
CREATE INDEX idx_docs_folder ON documents(folder_id);
```

---

## 9. Backlog / Post-Production Feature Requests

1. **Import & Export Engine:** Drag-and-drop parsing for `.xlsx`, `.docx`, and `.csv` files into Spinel canvas format, plus client-side PDF / Excel / Word exports.
2. **Automated Backup & Disaster Recovery:** Scheduled background script dumping PostgreSQL databases into encrypted archives sent to offsite object storage (e.g., DigitalOcean Spaces or AWS S3).
3. **Advanced System Diagnostics:** Admin view showing server RAM usage, active WebSocket connections, database storage growth, and background pruning log status.