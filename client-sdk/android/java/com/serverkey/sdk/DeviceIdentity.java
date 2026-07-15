package com.serverkey.sdk;

import android.content.Context;
import android.os.Build;
import android.provider.Settings;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

final class DeviceIdentity {
    private DeviceIdentity() {}

    static String create(Context context, String projectId) {
        String androidId = Settings.Secure.getString(
                context.getContentResolver(), Settings.Secure.ANDROID_ID);
        if (androidId == null || androidId.trim().isEmpty()) androidId = "unavailable";
        String material = projectId + "|" + context.getPackageName() + "|" + androidId;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(material.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(digest.length * 2);
            for (byte value : digest) out.append(String.format("%02x", value & 0xff));
            return out.toString();
        } catch (Exception error) {
            throw new IllegalStateException("Could not create device identity.", error);
        }
    }

    static String displayName(Context context) {
        String configuredName = "";
        try {
            configuredName = Settings.Global.getString(
                    context.getContentResolver(), "device_name");
        } catch (RuntimeException ignored) {}
        if (configuredName != null && !configuredName.trim().isEmpty()) {
            return limit(configuredName.trim(), 120);
        }

        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "Android device" : Build.MODEL.trim();
        if (!manufacturer.isEmpty() && !model.toLowerCase().startsWith(manufacturer.toLowerCase())) {
            model = manufacturer + " " + model;
        }
        return limit(model.isEmpty() ? "Android device" : model, 120);
    }

    private static String limit(String value, int maxLength) {
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
}
