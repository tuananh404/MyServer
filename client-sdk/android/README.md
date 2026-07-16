# ServerKey Android/IMGUI SDK V2

This is the complete reusable client SDK tested by the AovJava pilot. It keeps
the host's Activity, license dialog, toast, and IMGUI design untouched.
Android networking and Keystore work live in one platform file; native policy,
runtime gates, feature flags, notification state, and JNI entrypoints live in
the prebuilt static archive.

## Package layout

```text
java/com/serverkey/sdk/ServerKeyPlatform.java
java/com/serverkey/sdk/GeneratedConnection.java   # dashboard ZIP only
jni/ServerKey/include/serverkey_api.h
jni/ServerKey/include/serverkey_imgui.hpp
jni/ServerKey/lib/arm64-v8a/libserverkey_core.a
jni/ServerKey/lib/armeabi-v7a/libserverkey_core.a
jni/ServerKey/serverkey-prebuilt.mk
jni/ServerKey/serverkey.cmake
```

The two archives are universal release-stripped builds of the native code
validated by the AovJava pilot. They contain no product token, license,
session, dashboard password, database credential, debug metadata, or local
build path. A generated ZIP adds only the public connection URI for the
selected product/project.

## Requirements

- Android API 23 or newer for AES-256-GCM Android Keystore storage.
- Android NDK 26.1 is the reference toolchain; use C++17.
- Supported ABIs: `arm64-v8a` and `armeabi-v7a`.
- The host must already build and load one native `.so` library.
- HTTPS server URL and `android.permission.INTERNET`.

## Fast installation

Download the full SDK ZIP from the dashboard, extract it, then run:

```bash
sh install.sh /absolute/path/to/project/app/src/main
```

For a CMake project, pass the native target name as the second argument:

```bash
sh install.sh /absolute/path/to/project/app/src/main your_native_target
```

The installer copies one Java SDK file, generated connection settings when
present, native headers/archives, adds INTERNET permission, adds ProGuard JNI
rules, and automatically links a single-target Android.mk project.

## Native link

The archive must be linked whole because JNI entrypoints are discovered by
name and otherwise look unused to the native linker.

For ndk-build, declare the prebuilt module before the host module:

```make
LOCAL_PATH := $(call my-dir)
include $(LOCAL_PATH)/ServerKey/serverkey-prebuilt.mk

include $(CLEAR_VARS)
LOCAL_MODULE := your_native_library
# existing LOCAL_SRC_FILES and libraries
LOCAL_WHOLE_STATIC_LIBRARIES += serverkey_core
include $(BUILD_SHARED_LIBRARY)
```

For CMake, add these lines after the host `add_library(...)`:

```cmake
include(${CMAKE_CURRENT_LIST_DIR}/ServerKey/serverkey.cmake)
serverkey_link(your_native_library)
```

Keep the fixed Java package `com.serverkey.sdk`. The application package can
be anything. Call `System.loadLibrary("your_native_library")` before creating
the Java runtime.

## Java lifecycle

The Activity implements `ServerKeyPlatform.Listener` but keeps ownership of
all UI:

```java
import com.serverkey.sdk.GeneratedConnection;
import com.serverkey.sdk.ServerKeyPlatform;

private ServerKeyPlatform serverKey;

// Run after System.loadLibrary(...).
private void startServerKey() {
    serverKey = ServerKeyPlatform.create(
            getApplicationContext(),
            GeneratedConnection.CONNECTION_URI,
            GeneratedConnection.APP_VERSION,
            this);
    serverKey.start();
}

@Override public void onPolicy(ServerKeyPlatform.Policy policy) {
    if (policy.sessionValid) dismissExistingLicenseUi();
    // policy.notificationFresh exposes a newly delivered server notification.
}

@Override public void onActivationRequired(String message) {
    showExistingLicenseUi(message);
}

@Override public void onConnectionState(String state, String message) {
    updateExistingStatusUi(state, message);
}

private void submitLicense(String license) {
    serverKey.activate(license);
}

@Override protected void onDestroy() {
    if (serverKey != null) serverKey.stop();
    super.onDestroy();
}
```

Those UI method names represent the host's existing UI. The SDK does not add
or replace dialogs, layouts, IMGUI widgets, toast styling, or navigation.

## Native runtime and feature mapping

All native state starts fail-closed. Start workers/hooks only after policy
authorization, and keep every active effect guarded:

```cpp
#include "serverkey_imgui.hpp"

if (!ServerKey::IsRuntimeAllowed() ||
    !ServerKey::IsFeatureEnabled("menu_auto")) {
    return;
}
```

Optional host callback:

```cpp
extern "C" void ServerKey_OnPolicyApplied() {
    if (!ServerKey::IsRuntimeAllowed()) {
        DisableAllRuntimeFeatures();
        return;
    }
    StartRuntimeFeaturesOnce();
}
```

Map each IMGUI group to a stable web feature key. `enabled=false` removes
access; `locked=true` keeps the group visible but read-only. Never treat
`menu_enabled` or one feature such as `menu_vip_core` as permission for every
other feature.

## Control contract

- All Clients Enabled is the global authorization switch.
- Maintenance Mode revokes runtime while heartbeat continues.
- Auto Update Allowed controls updater behavior only.
- Minimum Version rejects outdated semantic versions.
- Feature flags control individual host groups.
- Device/license/session bans fail closed on the next heartbeat.
- Notifications can target all clients or one reported device ID.

Heartbeat must remain running while the menu is locked so the web can unlock a
client without rebuilding or restarting it.

## Adding to a different project type

1. Generate a unique Project ID and connection URI from the dashboard.
2. Install the same universal `.a` package.
3. Link it into the native `.so` loaded by that application.
4. Start `ServerKeyPlatform` from the Android lifecycle.
5. Map that project's own feature keys to UI groups and runtime effects.
6. Reset reversible state whenever authorization or a feature is revoked.
7. Test activation, restart/session restore, offline expiry, every remote
   switch, bans, notification delivery, and both supported ABIs.

For a non-IMGUI native client, use the stable C ABI in `serverkey_api.h`.
`ServerKey_GetSnapshot`, `ServerKey_RuntimeAllowed`, and
`ServerKey_FeatureEnabled` do not depend on IMGUI.

## Verification

Verify archive integrity from this directory:

```bash
sha256sum -c SHA256SUMS
```

After linking, verify that the final host `.so` exports the fixed JNI bridge:

```bash
llvm-nm -D path/to/libyour_native_library.so | grep NativeBridge_nativeInitialize
```
