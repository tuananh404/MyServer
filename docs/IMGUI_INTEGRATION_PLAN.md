# Kế hoạch tích hợp ServerKey vào IMGUI và nhiều project

## 1. Kết quả cần đạt

SDK IMGUI phải dùng được lại cho nhiều ứng dụng mà không copy logic mạng, xác
thực hoặc update vào từng menu. Mỗi project chỉ đăng ký metadata và mapping
feature riêng. UI không gọi HTTP trực tiếp và không giữ khóa bí mật của server.

Tiêu chí hoàn thành:

- Kích hoạt license, bind device, tạo session và heartbeat chạy ngoài render thread.
- Web thay đổi menu, maintenance, auto-update, version hoặc device status thì
  client nhận ở heartbeat tiếp theo.
- Ban device/license hoặc revoke session làm client đóng menu ngay.
- Policy nhận từ cache chỉ được dùng khi còn hạn và có chữ ký hợp lệ.
- Payload không thể bị sửa mà client vẫn chấp nhận; request cũ không phát lại được.
- Một SDK core phục vụ nhiều project; phần IMGUI chỉ là adapter hiển thị.

## 2. Kiến trúc đích

```text
ImGui screens
    │ đọc immutable PolicySnapshot
ImGuiPolicyAdapter
    │
ServerKey SDK Core ── SecureStorage (Keystore / DPAPI / Keychain)
    │               ├─ DeviceKeyProvider
    │               └─ SignedPolicyCache
HTTPS Transport
    │ TLS 1.3 + SPKI pin + request proof
ServerKey API v2
    ├─ Activation / Session / Heartbeat
    ├─ Policy signing / Release manifest
    ├─ Replay protection / Rate limit
    └─ Audit events
Supabase + external nonce/rate-limit store
```

Render thread chỉ đọc snapshot đã được xác minh. Worker thread chịu trách nhiệm
activate, heartbeat, retry, cache và update snapshot bằng atomic swap.

## 3. Lớp bảo mật và mã hóa

### 3.1 Transport

- Chỉ dùng HTTPS, TLS 1.3; tắt redirect sang HTTP.
- Client pin SPKI SHA-256 của certificate, luôn đóng gói ít nhất một backup pin để
  xoay certificate không làm hỏng toàn bộ client.
- Server bật HSTS, `no-store` cho API và giới hạn kích thước request.

### 3.2 Danh tính device và chống replay

- Lần chạy đầu, client sinh key pair theo thiết bị. Ưu tiên ECDSA P-256 trong
  Android Keystore/Apple Keychain/Windows CNG; fallback Ed25519 qua libsodium khi
  platform không có hardware-backed key.
- Private key không gửi lên server. Server chỉ lưu public key, algorithm và key id.
- Mỗi request session gửi `method`, `path`, SHA-256 body, timestamp, nonce 128-bit,
  session id và chữ ký device key.
- Server chỉ chấp nhận clock window 60 giây và nonce chưa từng dùng. Nonce/rate
  limit lưu ở Upstash Redis hoặc kho dùng chung; không dựa vào RAM của một Vercel
  function.
- Session token vẫn là 256-bit random bearer token, raw token chỉ trả một lần và
  database chỉ lưu SHA-256 hash như schema hiện tại.

### 3.3 Xác thực policy và update

- Server ký policy bằng Ed25519. Client chỉ nhúng public key; signing private key
  nằm trong secret manager/KMS, không nằm trong source hoặc database public.
- Payload dùng JSON Canonicalization Scheme (RFC 8785) trước khi ký. Envelope gồm
  `project_id`, `device_id`, `session_id`, `revision`, `issued_at`, `expires_at`,
  `nonce`, `payload` và `signature`.
- Update manifest có chữ ký Ed25519 độc lập, SHA-256 artifact, version tăng đơn
  điệu, size và URL allowlist. Client kiểm chữ ký, hash và chống downgrade trước
  khi cài.

### 3.4 Mã hóa application-layer

TLS đã mã hóa đường truyền. Với license/policy đặc biệt nhạy cảm, phase hardening
dùng X25519 + HKDF-SHA-256 để tạo session key và XChaCha20-Poly1305 để mã hóa
envelope. Nonce 192-bit không tái sử dụng; associated data chứa project, session,
method và path. Dùng libsodium, không tự viết thuật toán mã hóa.

Không nhúng shared HMAC secret chung vào binary: secret đó có thể bị trích xuất và
sẽ làm lộ toàn bộ project. Binary chỉ chứa public key và public project id.

### 3.5 Lưu trữ local

- Android: Android Keystore qua JNI; Windows: DPAPI/CNG; Apple: Keychain/Secure
  Enclave; Linux desktop: Secret Service.
- Lưu session token, device key handle và signed cache. Không ghi license key,
  session token hoặc private key vào log.
- Cache policy được mã hóa bằng platform storage và vẫn phải kiểm chữ ký + hạn dùng
  sau khi giải mã.

## 4. Multi-project để dùng ở mọi menu

Thêm các entity server:

- `projects`: public id, slug, tên, trạng thái và signing key id.
- `project_configs`: policy/revision riêng từng project.
- `project_features`: feature flags riêng từng project.
- `project_releases`: version, channel, artifact URL/hash/signature, rollout.
- `device_credentials`: device public key, algorithm, key id và trạng thái.
- `request_nonces`: nonce TTL hoặc chuyển hoàn toàn sang Redis.
- Mọi token/package/license/device session có `project_id` và index tương ứng.

Mỗi binary chỉ cần manifest public:

```json
{
  "base_url": "https://example.vercel.app",
  "project_id": "aov-vip",
  "app_version": "1.0.0",
  "release_channel": "stable",
  "server_signing_public_key": "BASE64_ED25519_PUBLIC_KEY",
  "update_signing_public_key": "BASE64_ED25519_PUBLIC_KEY"
}
```

Manifest không chứa password, Supabase key, signing private key hoặc shared API
secret.

## 5. Contract API v2

- `POST /api/v2/client/activate`: project id, license, device public key, HWID hash,
  app version và client nonce; trả session cùng signed policy envelope.
- `POST /api/v2/client/heartbeat`: bearer session + signed request proof; trả policy
  mới khi revision đổi, nếu không trả `304`-style result nhẹ.
- `POST /api/v2/client/logout`: revoke session hiện tại.
- `GET /api/v2/client/release-manifest`: signed update manifest theo project/channel.
- Admin web thêm project selector, release manager, key rotation và audit trail.

Response lỗi có `code` ổn định cho code xử lý và `message` thật để hiển thị:
`invalid_license`, `device_limit`, `device_banned`, `license_banned`,
`session_expired`, `maintenance`, `upgrade_required`, `replay_detected`.

## 6. Cấu trúc SDK C++

```text
serverkey/
  core/ServerKeyClient.h/.cpp
  core/Models.h
  core/PolicyStore.h/.cpp
  core/SessionState.h/.cpp
  crypto/CryptoProvider.h
  crypto/SodiumCryptoProvider.cpp
  net/HttpTransport.h
  net/CurlHttpTransport.cpp
  platform/SecureStorage.h
  platform/android/AndroidKeystoreStorage.cpp
  platform/windows/DpapiStorage.cpp
  update/UpdateVerifier.h/.cpp
  imgui/ImGuiPolicyAdapter.h/.cpp
```

Các interface chính:

- `ServerKeyClient`: activate/start/stop/logout và state machine.
- `HttpTransport`: timeout, TLS pinning, retry có jitter.
- `CryptoProvider`: hash, verify Ed25519, device signature, optional envelope.
- `SecureStorage`: lưu handle/key/session theo platform.
- `PolicyStore`: chỉ publish snapshot đã verify.
- `ImGuiPolicyAdapter`: map feature key sang menu local.
- `UpdateVerifier`: kiểm manifest, version, hash và signature.

Project tích hợp đăng ký feature local. Server chỉ bật/tắt key đã tồn tại; response
không bao giờ tải code hoặc thực thi command tùy ý.

## 7. Luồng runtime

1. Khởi động: load manifest và signed cache; kiểm chữ ký/revision/expiry.
2. Chưa có session: activate trên worker thread và bind public device key.
3. Thành công: publish `PolicySnapshot`; IMGUI render theo `authorized` và feature.
4. Heartbeat: chạy theo interval server, thêm jitter 10%, exponential backoff khi
   mất mạng và không block frame.
5. Policy revision đổi: verify chữ ký rồi atomic swap snapshot.
6. Ban/revoke/expired: xóa session/cache được cấp quyền, đóng menu và hiển thị mã
   lỗi thật từ server.
7. Auto-update OFF: không gọi downloader. ON: chỉ tải release manifest đã ký; mọi
   artifact sai hash/signature đều bị loại.

Offline policy nên có grace period cấu hình theo project. Hết grace period thì
fail closed; không dùng cache vô thời hạn.

## 8. Thứ tự triển khai

### Phase 1 — Chuẩn hóa server cho multi-project

- Migration `project_id`, project selector trên web và API v2 song song API v1.
- Stable error codes, request id, audit log và shared rate limiter.
- Không xóa API v1 cho đến khi client cũ đã chuyển hết.

### Phase 2 — Ký policy và device-bound session

- Ed25519 signed envelope, device public-key registration, signed request proof,
  nonce TTL và key rotation.
- Test tamper, replay, clock skew, revoked session và signing-key rollover.

### Phase 3 — SDK core không phụ thuộc IMGUI

- Models, transport, crypto, secure storage, state machine và signed cache.
- Unit test bằng mock transport có dữ liệu kiểm soát; integration test với staging server.

### Phase 4 — IMGUI adapter

- Status panel, login/activation view, feature registry và thread-safe snapshot.
- Không gọi network trong `OnGUI`/render loop.

### Phase 5 — Update an toàn

- Signed release manager trên web, staged rollout, hash verification, rollback và
  hard lock `auto_update_enabled`.

### Phase 6 — QA và rollout

- Android/Windows matrix; mạng chậm/offline; resume/sleep; clock sai; nhiều device;
  ban/unban; revoke; migration; rotation; mobile/desktop web regression.
- Canary project trước, sau đó mở stable theo phần trăm.

## 9. Definition of done

- Không secret server nào tồn tại trong binary.
- MITM, payload tamper, replay và downgrade tests đều bị từ chối.
- Ban/revoke có hiệu lực không quá một heartbeat interval.
- UI giữ frame time ổn định khi API chậm hoặc mất mạng.
- Hai project mẫu dùng cùng SDK nhưng policy, signing key, release và feature khác
  nhau.
- Web có audit log cho activate, ban, revoke, config change, release và key rotate.
