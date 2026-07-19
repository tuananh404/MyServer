#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
    echo "Usage: sh install.sh /path/to/app/src/main [cmake-native-target]" >&2
    exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=$1
CMAKE_TARGET=${2:-}

if [ -n "$CMAKE_TARGET" ] && ! printf '%s' "$CMAKE_TARGET" | grep -Eq '^[A-Za-z0-9_.:+-]+$'; then
    echo "cmake-native-target contains unsupported characters: $CMAKE_TARGET" >&2
    exit 2
fi

if [ ! -f "$TARGET/AndroidManifest.xml" ]; then
    echo "AndroidManifest.xml was not found under: $TARGET" >&2
    exit 2
fi

JAVA_TARGET="$TARGET/java/com/serverkey/sdk"
BUILD_KIND=manual
if [ -n "$CMAKE_TARGET" ] && [ -f "$TARGET/cpp/CMakeLists.txt" ]; then
    NATIVE_ROOT="$TARGET/cpp"
    BUILD_KIND=cmake
elif [ -f "$TARGET/jni/Android.mk" ]; then
    NATIVE_ROOT="$TARGET/jni"
    BUILD_KIND=ndk-build
elif [ -f "$TARGET/cpp/CMakeLists.txt" ]; then
    NATIVE_ROOT="$TARGET/cpp"
    BUILD_KIND=cmake
else
    NATIVE_ROOT="$TARGET/cpp"
fi

mkdir -p "$JAVA_TARGET" "$NATIVE_ROOT/ServerKey"
cp -f "$SCRIPT_DIR"/java/com/serverkey/sdk/ServerKeyPlatform.java "$JAVA_TARGET/"
if [ -f "$SCRIPT_DIR/java/com/serverkey/sdk/GeneratedConnection.java" ]; then
    cp -f "$SCRIPT_DIR/java/com/serverkey/sdk/GeneratedConnection.java" "$JAVA_TARGET/"
fi
cp -R "$SCRIPT_DIR/jni/ServerKey/." "$NATIVE_ROOT/ServerKey/"

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

APP_DIR=$(CDPATH= cd -- "$TARGET/../.." && pwd)
PROGUARD="$APP_DIR/proguard-rules.pro"
if [ -f "$PROGUARD" ]; then
    if ! grep -q 'keepnames class com.serverkey.sdk.NativeBridge' "$PROGUARD"; then
        printf '\n# ServerKey fixed JNI bridge (names only)\n-keepnames class com.serverkey.sdk.NativeBridge\n-keepclassmembernames class com.serverkey.sdk.NativeBridge {\n    native <methods>;\n}\n' >> "$PROGUARD"
    fi
fi

if [ "$BUILD_KIND" = ndk-build ]; then
    ANDROID_MK="$NATIVE_ROOT/Android.mk"
    if ! grep -q 'ServerKey/serverkey-prebuilt.mk' "$ANDROID_MK"; then
        TEMP_MK="$ANDROID_MK.serverkey.tmp"
        awk '
            /^LOCAL_PATH[[:space:]]*:?=/ && !inserted {
                print
                print "include $(LOCAL_PATH)/ServerKey/serverkey-prebuilt.mk"
                inserted=1
                next
            }
            { print }
        ' "$ANDROID_MK" > "$TEMP_MK"
        mv "$TEMP_MK" "$ANDROID_MK"
    fi

    SHARED_COUNT=$(grep -Ec 'include[[:space:]]+\$\(BUILD_SHARED_LIBRARY\)' "$ANDROID_MK" || true)
    if grep -Eq 'LOCAL_WHOLE_STATIC_LIBRARIES.*serverkey_core' "$ANDROID_MK"; then
        TEMP_MK="$ANDROID_MK.serverkey.tmp"
        awk '
            /LOCAL_WHOLE_STATIC_LIBRARIES.*serverkey_core/ {
                gsub(/serverkey_core/, "")
                print
                print "LOCAL_STATIC_LIBRARIES += serverkey_core"
                next
            }
            { print }
        ' "$ANDROID_MK" > "$TEMP_MK"
        mv "$TEMP_MK" "$ANDROID_MK"
    fi
    if [ "$SHARED_COUNT" -eq 1 ] && ! grep -Eq 'LOCAL_STATIC_LIBRARIES.*serverkey_core' "$ANDROID_MK"; then
        TEMP_MK="$ANDROID_MK.serverkey.tmp"
        awk '
            /include[[:space:]]+\$\(BUILD_SHARED_LIBRARY\)/ && !inserted {
                print "LOCAL_STATIC_LIBRARIES += serverkey_core"
                inserted=1
            }
            { print }
        ' "$ANDROID_MK" > "$TEMP_MK"
        mv "$TEMP_MK" "$ANDROID_MK"
    elif [ "$SHARED_COUNT" -ne 1 ]; then
        echo "Android.mk has $SHARED_COUNT shared targets; add this to the target loaded by Java:" >&2
        echo "LOCAL_STATIC_LIBRARIES += serverkey_core" >&2
    fi
    if [ "$SHARED_COUNT" -eq 1 ] && ! grep -q 'Java_com_serverkey_sdk_NativeBridge_nativeInitialize' "$ANDROID_MK"; then
        TEMP_MK="$ANDROID_MK.serverkey.tmp"
        awk '
            /include[[:space:]]+\$\(BUILD_SHARED_LIBRARY\)/ && !inserted {
                print "LOCAL_LDFLAGS += -Wl,-u,Java_com_serverkey_sdk_NativeBridge_nativeInitialize"
                inserted=1
            }
            { print }
        ' "$ANDROID_MK" > "$TEMP_MK"
        mv "$TEMP_MK" "$ANDROID_MK"
    elif [ "$SHARED_COUNT" -ne 1 ]; then
        echo "LOCAL_LDFLAGS += -Wl,-u,Java_com_serverkey_sdk_NativeBridge_nativeInitialize" >&2
    fi
elif [ "$BUILD_KIND" = cmake ]; then
    CMAKE_FILE="$NATIVE_ROOT/CMakeLists.txt"
    if [ -n "$CMAKE_TARGET" ]; then
        if ! grep -q 'ServerKey/serverkey.cmake' "$CMAKE_FILE"; then
            printf '\n# ServerKey V2 static SDK\ninclude(${CMAKE_CURRENT_LIST_DIR}/ServerKey/serverkey.cmake)\n' >> "$CMAKE_FILE"
        fi
        if ! grep -Fq "serverkey_link($CMAKE_TARGET)" "$CMAKE_FILE"; then
            printf 'serverkey_link(%s)\n' "$CMAKE_TARGET" >> "$CMAKE_FILE"
        fi
    else
        echo "CMake target was not supplied. Add these lines after add_library(...):" >&2
        echo 'include(${CMAKE_CURRENT_LIST_DIR}/ServerKey/serverkey.cmake)' >&2
        echo 'serverkey_link(your_native_target)' >&2
    fi
else
    echo "No Android.mk or cpp/CMakeLists.txt was detected." >&2
    echo "Copy succeeded; follow README.md section 'Native link' manually." >&2
fi

echo "ServerKey V2.1.2 installed into: $TARGET"
echo "Load the host native library before ServerKeyPlatform.create(...)."
echo "Use GeneratedConnection.CONNECTION_URI when installing a dashboard ZIP."
