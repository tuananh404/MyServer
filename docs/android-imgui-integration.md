# Android/IMGUI client integration

ServerKey clients use a two-layer design:

1. The single `ServerKeyPlatform.java` owns HTTPS activation, encrypted session
   persistence, device metadata, heartbeat, and lifecycle.
2. `libserverkey_core.a` owns fixed JNI entrypoints, one fail-closed atomic
   master gate, versioned policy state, per-feature gates, and the standard
   lock/notification IMGUI surfaces.

The server contract is intentionally client-agnostic, so the same control plane
can manage Java overlays, native IMGUI, or another UI framework.

## Control semantics

| Web control | Client behavior |
| --- | --- |
| All Clients Enabled | Global authorization master switch |
| Maintenance Mode | Locks runtime while heartbeat stays online |
| Auto Update Allowed | Enables updater logic only |
| Minimum Version | Locks builds below the configured semantic version |
| Notification | Delivers a global or device-targeted message independently from lock/error state |
| Feature enabled | Allows one named feature group |
| Feature locked | Shows the group as read-only |

`Auto Update Allowed` is deliberately independent. To make every function
ineffective, disable `All Clients Enabled`; this still permits heartbeat so the
same clients can be unlocked later from the web.

## Client sequence

```text
boot locked
  -> restore encrypted session or request license
  -> POST /api/v1/client/activate
  -> apply config + feature policy
  -> start native hooks only when authorized
  -> POST /api/v1/client/heartbeat at the server interval
  -> update device name + receive the next targeted/global notification
  -> atomically revoke effects when policy becomes unauthorized
```

Every functional hook must check the native master gate. Disabling or hiding an
IMGUI widget alone is not sufficient, because a previously enabled value may
still be consumed by a hook.

## Credentials

- Product token: public product identifier embedded in the client; it chooses
  the license pool. It is not an “all client license” and is not an admin key.
- License key: customer credential entered on the device.
- Session token: short-lived 256-bit bearer credential returned after license
  activation. Store it encrypted and never log it.
- Supabase service-role, dashboard password, GitHub/Vercel tokens: server-side
  secrets only; never place them in APK/native code.

## Recommended Android baseline

- HTTPS-only network security configuration and `usesCleartextTraffic=false`.
- AES-256-GCM session storage using a non-exportable Android Keystore key.
- Deterministic per-installation/device identifier scoped by project and app.
- Bounded HTTP response body, connection/read timeouts, heartbeat jitter, and a
  short offline grace followed by fail-closed behavior.
- Report the user-visible Android device name on activation and heartbeat while
  keeping the stable hashed HWID as the authorization identity.
- Acknowledge notification IDs and persist the latest full notification in the
  same encrypted store so a toast is not replayed after every heartbeat.
- Session storage contains only the short-lived session token and notification
  state; license keys are never persisted. After expiry, require the user to
  enter the license again. Explicit revocation and bans stay locked.

The tracked V2.1.2 package is in
[`client-sdk/android`](../client-sdk/android/README.md). The native archives are
the same binaries validated by the AovJava pilot. A project-specific adapter
maps keys such as `menu_vip_core`, `menu_aim`, `menu_auto`, and
`menu_information` to its existing IMGUI tabs and hook entry points.

The host calls `ServerKey::DrawUi` for the lock panel, notification page, and
notification overlay. It only handles the returned navigation request. The
renderer, unread state, animation, localization, and touch bounds are compiled
inside the static archive rather than copied into each customer's `main.cpp`.

## Update adapter

An updater consumes `auto_update_enabled`, `latest_version`, and `update_url`.
It should verify the artifact hash/signature before invoking Android's package
installer. IL2CPP symbol resolution is unrelated to APK auto-update and should
remain a separate native module.

## Acceptance tests

Verify activation, encrypted session restore, 24-hour session renewal, explicit
session revocation, global disable/enable, maintenance, all feature states,
global and per-device notifications, minimum version, device/license ban, offline grace expiry,
and both update-switch states on a real Android device.
