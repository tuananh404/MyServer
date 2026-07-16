# ServerKey Control Plane v4.2

Web dashboard and API for license activation, device management, live client
sessions, remote menu configuration, feature flags, and update policy.

## Main capabilities

- Token/product packages and license-key generation
- Multi-device license activation
- Independent device ban/unban with automatic session revocation
- Short-lived client sessions stored as SHA-256 token hashes
- Heartbeat-based revocation while a client is running
- Remote `menu_enabled`, maintenance, version, and auto-update policy
- Dynamic feature flags for IMGUI menu groups
- Fraud/security event log
- Vercel-compatible Express API and static dashboard
- Responsive business console with real per-module health/error states

The reusable IMGUI and multi-project architecture is documented in
[`docs/IMGUI_INTEGRATION_PLAN.md`](./docs/IMGUI_INTEGRATION_PLAN.md).

## Database migration

Open the Supabase SQL Editor and run the complete [`supabase.sql`](./supabase.sql)
file. The migration is idempotent and upgrades the previous v1-v3 schema.

The v4 migration adds:

- `devices`
- `client_sessions`
- `client_config`
- `feature_flags`
- structured columns on `fraud_logs`
- the transactional `activate_client_license` database function

Run the SQL migration before deploying the v4 API. Existing token, key, device
binding, and fraud-log data is preserved.

## Environment variables

Copy `.env.example` to `.env` for local development and configure the same
values in Vercel:

```env
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY
ADMIN_PASSWORD=ADMIN_DASHBOARD_PASSWORD
ALLOWED_ORIGINS=https://YOUR_VERCEL_DOMAIN
PORT=3000
NODE_ENV=development
```

`ALLOWED_ORIGINS` is optional. When omitted, same-origin dashboard requests and
native clients continue to work. Multiple browser origins are comma-separated.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Health check:

```bash
curl http://localhost:3000/api/health
```

Quality checks:

```bash
npm run check
npm test
```

## Client activation

Both routes use the v4 activation flow:

- `POST /api/client/login` for compatibility
- `POST /api/v1/client/activate` for new clients

Request:

```json
{
  "token_string": "TKN_PRODUCT_TOKEN",
  "key_string": "key-30day-EXAMPLE",
  "hwid": "HWID_DEVICE_INSTALLATION_ID",
  "device_name": "Samsung Galaxy S24 Ultra",
  "project_id": "client.vip.android",
  "app_version": "1.0.0",
  "last_notification_id": ""
}
```

Successful response:

```json
{
  "success": true,
  "authorized": true,
  "authorization_code": "ok",
  "authorization_message": "ServerKey đã cấp quyền · Client authorized by ServerKey.",
  "token": "SKS_SESSION_TOKEN",
  "session_id": 12,
  "session_expires_at": "2026-07-16T12:00:00.000Z",
  "expires_at": "2026-08-14T12:00:00.000Z",
  "duration_days": 30,
  "device_id": 8,
  "device_name": "Samsung Galaxy S24 Ultra",
  "project_id": "client.vip.android",
  "notification": {
    "id": "b93b0d55-4d57-48a3-9fa5-9e493f12004b",
    "title": "ServerKey",
    "message": "Nội dung đầy đủ được đọc trong tab Thông báo.",
    "created_at": "2026-07-15T12:00:00.000Z"
  },
  "config": {
    "menu_enabled": true,
    "maintenance_mode": false,
    "auto_update_enabled": false,
    "minimum_version": "1.0.0",
    "latest_version": "1.1.0",
    "heartbeat_interval_seconds": 45,
    "config_revision": 9
  },
  "features": {
    "menu_vip_core": {
      "enabled": true,
      "locked": false,
      "display_name": "VIP Core"
    }
  }
}
```

`authorized` becomes false when All Clients is disabled, maintenance mode is
active, or the client version is missing, malformed, or below
`minimum_version`. The client must display `authorization_message` and disable
its runtime effects in that state. Notifications are a separate payload and
must never be used as an authorization or error message.
`auto_update_enabled` controls only the updater and is not a global access
switch.

## Client heartbeat

Send the raw session token as a bearer token:

```http
POST /api/v1/client/heartbeat
Authorization: Bearer SKS_SESSION_TOKEN
Content-Type: application/json

{
  "app_version":"1.0.0",
  "device_name":"Samsung Galaxy S24 Ultra",
  "project_id":"client.vip.android",
  "last_notification_id":"b93b0d55-4d57-48a3-9fa5-9e493f12004b"
}
```

Heartbeat is the authenticated background check-in from a running client. It
updates the device's last-seen time/name and returns the latest policy, feature
flags, bans, and the newest global or per-device notification. The client uses
`heartbeat_interval_seconds` with a minimum of 15 seconds; the Android reference
adds ±10% jitter to avoid every device contacting the server simultaneously.
A banned device, banned/expired license, revoked session, maintenance state, or
disabled menu is therefore enforced on the next heartbeat. Heartbeat remains
active while the menu is globally disabled so the same client can be unlocked
without restarting.

For the reusable Android/IMGUI architecture, security boundaries, control
semantics, and acceptance checklist, see
[`docs/android-imgui-integration.md`](docs/android-imgui-integration.md).
The platform-neutral REST contract and Project Connect endpoints are documented
in [`docs/universal-client-api.md`](docs/universal-client-api.md).

## Drop-in Android/IMGUI SDK

The package-stable client kit lives in
[`client-sdk/android`](client-sdk/android/README.md). Install it into another
Android IMGUI project with one command:

```bash
sh client-sdk/android/install.sh /absolute/path/to/project/app/src/main
```

SDK V2 copies one Java platform bridge plus universal native `.a` archives,
adds Internet permission, supports single-target `Android.mk` automatically,
and includes a CMake link helper. The host package, Activity, login UI, toast,
and IMGUI layout remain owned by the client project.

Logout:

```http
POST /api/v1/client/logout
Authorization: Bearer SKS_SESSION_TOKEN
```

## Admin API

The dashboard exchanges the admin password for a signed 12-hour session:

```http
POST /api/admin/login
Content-Type: application/json

{"password":"ADMIN_PASSWORD"}
```

Use the returned token on admin routes:

```http
Authorization: Bearer ADM_SIGNED_SESSION_TOKEN
```

Control-plane endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/admin/control-config` | Load remote policy and feature flags |
| PATCH | `/api/admin/control-config` | Update menu, maintenance, version, and update policy |
| POST | `/api/admin/notifications` | Send a global or per-device notification |
| POST | `/api/admin/integration-manifest` | Generate a verified project connection URI |
| POST | `/api/admin/sdk-package` | Download an authenticated, preconfigured full Android SDK ZIP |
| POST | `/api/admin/feature-flag` | Create or update a feature flag |
| DELETE | `/api/admin/feature-flag` | Delete a feature flag |
| GET | `/api/admin/devices` | List devices, linked licenses, and active sessions |
| POST | `/api/admin/device-status` | Ban or unban one device |
| GET | `/api/admin/sessions` | List recent client sessions |
| POST | `/api/admin/revoke-session` | Revoke a running client session |

Existing token, key, stats, and fraud-log admin routes remain compatible.

Public client discovery endpoint:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/sdk/bootstrap/:productToken` | Resolve safe SDK/API metadata for a project ID and app version |

## Vercel deployment

1. Run `supabase.sql` in the target Supabase project.
2. Push this repository to GitHub.
3. Import the repository into Vercel.
4. Add the environment variables listed above.
5. Deploy and verify `/api/health` reports `status: ok` and version `4.6.0`.

The GitHub/Vercel integration will redeploy automatically after later pushes to
the configured production branch.
