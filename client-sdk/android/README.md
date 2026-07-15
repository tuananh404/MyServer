# ServerKey Android/IMGUI drop-in SDK

This folder is the reusable client layer used by the `aovjava` reference app.
It is independent from the host app package, Activity, and IMGUI class name.
It has no third-party Java or C++ dependency.

## 1. Install the sources

From the ServerKey repository root:

```bash
sh client-sdk/android/install.sh /absolute/path/to/your-project/app/src/main
```

For an `Android.mk` project, the installer also adds the two native source
files automatically. For CMake, add these sources to the existing library:

```cmake
target_sources(your_native_library PRIVATE
    ServerKey/RemotePolicy.cpp
    ServerKey/NativeBridge.cpp)
```

Load that native library before starting ServerKey. The bridge uses the fixed
JNI package `com.serverkey.sdk`, so changing the host application's package
does not require editing C++.

## 2. Start it from the Activity

Keep the four project values in one settings class, then create the runtime:

```java
serverKey = ServerKeyRuntime.create(
        getApplicationContext(),
        ServerKeySettings.BASE_URL,
        ServerKeySettings.PRODUCT_TOKEN,
        ServerKeySettings.PROJECT_ID,
        ServerKeySettings.APP_VERSION,
        this);
serverKey.start();
```

The Activity implements `ServerKeyRuntime.Listener`. Its three callbacks only
manage UI:

```java
@Override public void onPolicy(RemotePolicy policy) {
    if (policy.sessionValid) dismissLicenseDialog();
}

@Override public void onActivationRequired(String message) {
    showLicenseDialog(message);
}

@Override public void onConnectionState(String state, String message) {
    updateLicenseStatus(state, message);
}
```

Submit and lifecycle calls are one line each:

```java
serverKey.activate(licenseInput.getText().toString());
serverKey.stop(); // Activity.onDestroy()
```

## 3. Connect project-specific native behavior

All policy parsing, master gates, feature gates, device identity, encrypted
session storage, heartbeat, bans, and notifications are already handled by the
SDK. A host that starts hooks or resets live toggles implements this optional
callback in its existing native source:

```cpp
extern "C" void ServerKey_OnPolicyApplied() {
    ResetDisabledRuntimeEffects();
    if (ServerKey::IsRuntimeAllowed()) StartNativeWorkersOnce();
}
```

Every active effect still checks the master and feature gate:

```cpp
if (!ServerKey::IsRuntimeAllowed() ||
    !ServerKey::IsFeatureEnabled("menu_auto")) {
    return;
}
```

The SDK intentionally does not contain a license dialog or IMGUI layout. Those
are visual choices owned by the host project; network and authorization logic
must remain inside `ServerKeyRuntime`.

## Required settings

- `BASE_URL`: HTTPS ServerKey deployment URL.
- `PRODUCT_TOKEN`: public product identifier created by the web console.
- `PROJECT_ID`: stable unique name for this client family.
- `APP_VERSION`: semantic client version such as `1.0.0`.

Never embed the admin password, Supabase service-role key, or deployment token
in a client project.

## Standalone verification

The native policy gate has a host-independent smoke test:

```bash
c++ -std=c++17 client-sdk/android/tests/RemotePolicyTest.cpp \
    client-sdk/android/jni/ServerKey/RemotePolicy.cpp \
    -o /tmp/serverkey-policy-test && /tmp/serverkey-policy-test
```
