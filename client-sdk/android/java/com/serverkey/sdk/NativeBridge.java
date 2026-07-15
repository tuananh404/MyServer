package com.serverkey.sdk;

/**
 * Package-stable JNI bridge. It does not depend on the host application's
 * package name, Activity name, or GLSurfaceView class.
 */
public final class NativeBridge {
    private NativeBridge() {}

    static void apply(RemotePolicy policy) {
        try {
            nativeApplyPolicy(
                    policy.authorized,
                    policy.menuEnabled,
                    policy.maintenanceMode,
                    policy.autoUpdateEnabled,
                    policy.minimumVersion,
                    policy.latestVersion,
                    policy.updateUrl,
                    policy.announcement,
                    policy.notificationId,
                    policy.notificationTitle,
                    policy.notificationMessage,
                    policy.notificationCreatedAt,
                    policy.notificationFresh,
                    policy.configRevision,
                    policy.featuresWire,
                    policy.statusCode,
                    policy.statusMessage);
        } catch (UnsatisfiedLinkError error) {
            throw linkageError(error);
        }
    }

    static void setConnectionState(String state, String message) {
        try {
            nativeSetConnectionState(state == null ? "" : state,
                    message == null ? "" : message);
        } catch (UnsatisfiedLinkError error) {
            throw linkageError(error);
        }
    }

    private static IllegalStateException linkageError(UnsatisfiedLinkError cause) {
        return new IllegalStateException(
                "ServerKey native bridge is missing. Compile ServerKey/NativeBridge.cpp " +
                "into the same native library and load that library before ServerKeyRuntime.start().",
                cause);
    }

    private static native void nativeApplyPolicy(
            boolean authorized,
            boolean menuEnabled,
            boolean maintenanceMode,
            boolean autoUpdateEnabled,
            String minimumVersion,
            String latestVersion,
            String updateUrl,
            String announcement,
            String notificationId,
            String notificationTitle,
            String notificationMessage,
            String notificationCreatedAt,
            boolean notificationFresh,
            long configRevision,
            String featuresWire,
            String statusCode,
            String statusMessage);

    private static native void nativeSetConnectionState(String state, String message);
}
