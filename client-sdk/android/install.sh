#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "Usage: sh client-sdk/android/install.sh /path/to/app/src/main" >&2
    exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=$1

if [ ! -f "$TARGET/AndroidManifest.xml" ]; then
    echo "AndroidManifest.xml was not found under: $TARGET" >&2
    exit 2
fi

JAVA_TARGET="$TARGET/java/com/serverkey/sdk"
if [ -f "$TARGET/cpp/CMakeLists.txt" ]; then
    NATIVE_ROOT="$TARGET/cpp"
else
    NATIVE_ROOT="$TARGET/jni"
fi
JNI_TARGET="$NATIVE_ROOT/ServerKey"
mkdir -p "$JAVA_TARGET" "$JNI_TARGET"
cp -f "$SCRIPT_DIR"/java/com/serverkey/sdk/*.java "$JAVA_TARGET"/
cp -f "$SCRIPT_DIR"/jni/ServerKey/* "$JNI_TARGET"/

MANIFEST="$TARGET/AndroidManifest.xml"
if ! grep -q 'android.permission.INTERNET' "$MANIFEST"; then
    TEMP_MANIFEST="$MANIFEST.serverkey.tmp"
    awk '
        /<application/ && !inserted {
            print "    <uses-permission android:name=\"android.permission.INTERNET\" />"
            inserted=1
        }
        { print }
    ' "$MANIFEST" > "$TEMP_MANIFEST"
    mv "$TEMP_MANIFEST" "$MANIFEST"
fi

ANDROID_MK="$NATIVE_ROOT/Android.mk"
if [ -f "$ANDROID_MK" ] && ! grep -q 'ServerKey/NativeBridge.cpp' "$ANDROID_MK"; then
    TEMP_MK="$ANDROID_MK.serverkey.tmp"
    awk '
        /include[[:space:]]*\$\(BUILD_SHARED_LIBRARY\)/ && !inserted {
            print "LOCAL_SRC_FILES += ServerKey/RemotePolicy.cpp ServerKey/NativeBridge.cpp"
            inserted=1
        }
        { print }
    ' "$ANDROID_MK" > "$TEMP_MK"
    mv "$TEMP_MK" "$ANDROID_MK"
fi

APP_DIR=$(CDPATH= cd -- "$TARGET/../.." && pwd)
PROGUARD="$APP_DIR/proguard-rules.pro"
if [ -f "$PROGUARD" ] && ! grep -q 'com.serverkey.sdk.NativeBridge' "$PROGUARD"; then
    printf '\n# ServerKey fixed JNI package\n-keep class com.serverkey.sdk.NativeBridge { *; }\n' >> "$PROGUARD"
fi

echo "ServerKey Android SDK installed into: $TARGET"
if [ ! -f "$ANDROID_MK" ]; then
    echo "Native build note: add ServerKey/RemotePolicy.cpp and ServerKey/NativeBridge.cpp to your CMake/ndk-build target."
fi
echo "Next: load your native library, create ServerKeyRuntime, then call start()."
