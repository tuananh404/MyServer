#include "RemotePolicy.h"

#include <jni.h>
#include <string>

// Optional host callback. A project that needs to reset live toggles or start
// hook workers after authorization can implement this symbol in its main.cpp.
extern "C" void ServerKey_OnPolicyApplied() __attribute__((weak));

namespace {
std::string JStringToUtf8(JNIEnv* env, jstring value) {
    if (!env || !value) return {};
    const char* chars = env->GetStringUTFChars(value, nullptr);
    if (!chars) return {};
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}
}

extern "C" JNIEXPORT void JNICALL
Java_com_serverkey_sdk_NativeBridge_nativeApplyPolicy(
        JNIEnv* env, jclass,
        jboolean authorized, jboolean menuEnabled,
        jboolean maintenanceMode, jboolean autoUpdateEnabled,
        jstring minimumVersion, jstring latestVersion,
        jstring updateUrl, jstring announcement,
        jstring notificationId, jstring notificationTitle,
        jstring notificationMessage, jstring notificationCreatedAt,
        jboolean notificationFresh, jlong configRevision,
        jstring featuresWire, jstring statusCode, jstring statusMessage) {
    ServerKey::ApplyPolicy(
            authorized == JNI_TRUE,
            menuEnabled == JNI_TRUE,
            maintenanceMode == JNI_TRUE,
            autoUpdateEnabled == JNI_TRUE,
            JStringToUtf8(env, minimumVersion),
            JStringToUtf8(env, latestVersion),
            JStringToUtf8(env, updateUrl),
            JStringToUtf8(env, announcement),
            JStringToUtf8(env, notificationId),
            JStringToUtf8(env, notificationTitle),
            JStringToUtf8(env, notificationMessage),
            JStringToUtf8(env, notificationCreatedAt),
            notificationFresh == JNI_TRUE,
            static_cast<uint64_t>(configRevision),
            JStringToUtf8(env, featuresWire),
            JStringToUtf8(env, statusCode),
            JStringToUtf8(env, statusMessage));

    if (ServerKey_OnPolicyApplied) ServerKey_OnPolicyApplied();
}

extern "C" JNIEXPORT void JNICALL
Java_com_serverkey_sdk_NativeBridge_nativeSetConnectionState(
        JNIEnv* env, jclass, jstring state, jstring message) {
    ServerKey::SetConnectionState(
            JStringToUtf8(env, state),
            JStringToUtf8(env, message));
}
