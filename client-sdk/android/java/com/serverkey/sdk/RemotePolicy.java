package com.serverkey.sdk;

import org.json.JSONObject;

import java.util.Iterator;

public final class RemotePolicy {
    public final boolean sessionValid;
    public final boolean authorized;
    public final boolean menuEnabled;
    public final boolean maintenanceMode;
    public final boolean autoUpdateEnabled;
    public final String minimumVersion;
    public final String latestVersion;
    public final String updateUrl;
    public final int heartbeatIntervalSeconds;
    public final String announcement;
    public final String notificationId;
    public final String notificationTitle;
    public final String notificationMessage;
    public final String notificationCreatedAt;
    public final boolean notificationFresh;
    public final long configRevision;
    public final String featuresWire;
    public final String statusCode;
    public final String statusMessage;

    private RemotePolicy(boolean sessionValid, boolean authorized, boolean menuEnabled,
                         boolean maintenanceMode, boolean autoUpdateEnabled,
                         String minimumVersion, String latestVersion, String updateUrl,
                         int heartbeatIntervalSeconds, String announcement,
                         String notificationId, String notificationTitle,
                         String notificationMessage, String notificationCreatedAt,
                         boolean notificationFresh,
                         long configRevision, String featuresWire,
                         String statusCode, String statusMessage) {
        this.sessionValid = sessionValid;
        this.authorized = authorized;
        this.menuEnabled = menuEnabled;
        this.maintenanceMode = maintenanceMode;
        this.autoUpdateEnabled = autoUpdateEnabled;
        this.minimumVersion = minimumVersion;
        this.latestVersion = latestVersion;
        this.updateUrl = updateUrl;
        this.heartbeatIntervalSeconds = heartbeatIntervalSeconds;
        this.announcement = announcement;
        this.notificationId = notificationId;
        this.notificationTitle = notificationTitle;
        this.notificationMessage = notificationMessage;
        this.notificationCreatedAt = notificationCreatedAt;
        this.notificationFresh = notificationFresh;
        this.configRevision = configRevision;
        this.featuresWire = featuresWire;
        this.statusCode = statusCode;
        this.statusMessage = statusMessage;
    }

    static RemotePolicy fromResponse(JSONObject response,
                                     String previousNotificationId,
                                     String previousNotificationTitle,
                                     String previousNotificationMessage,
                                     String previousNotificationCreatedAt) throws Exception {
        JSONObject config = response.optJSONObject("config");
        if (config == null) throw new IllegalStateException("Server response is missing config.");
        JSONObject features = response.optJSONObject("features");
        if (features == null) features = new JSONObject();
        int heartbeat = config.optInt("heartbeat_interval_seconds", 45);
        if (heartbeat < 15) heartbeat = 15;
        if (heartbeat > 3600) heartbeat = 3600;
        String announcement = "";
        JSONObject notification = response.optJSONObject("notification");
        String notificationId = previousNotificationId == null ? "" : previousNotificationId;
        String notificationTitle = previousNotificationTitle == null ? "" : previousNotificationTitle;
        String notificationMessage = previousNotificationMessage == null ? "" : previousNotificationMessage;
        String notificationCreatedAt = previousNotificationCreatedAt == null ? "" : previousNotificationCreatedAt;
        boolean notificationFresh = false;
        if (notification != null) {
            String receivedId = notification.optString("id", "").trim();
            String receivedMessage = notification.optString("message", "").trim();
            if (!receivedId.isEmpty() && !receivedMessage.isEmpty()) {
                notificationId = receivedId;
                notificationTitle = notification.optString("title", "ServerKey").trim();
                notificationMessage = receivedMessage;
                notificationCreatedAt = notification.optString("created_at", "").trim();
                notificationFresh = true;
            }
        }
        String statusMessage = response.optString("authorization_message",
                response.optString("message", "")).trim();
        if (statusMessage.isEmpty()) statusMessage = announcement;
        return new RemotePolicy(
                true,
                response.optBoolean("authorized", false),
                config.optBoolean("menu_enabled", false),
                config.optBoolean("maintenance_mode", false),
                config.optBoolean("auto_update_enabled", false),
                config.optString("minimum_version", ""),
                config.optString("latest_version", ""),
                config.optString("update_url", ""),
                heartbeat,
                announcement,
                notificationId,
                notificationTitle,
                notificationMessage,
                notificationCreatedAt,
                notificationFresh,
                config.optLong("config_revision", 0),
                encodeFeatures(features),
                response.optString("authorization_code", "ok"),
                statusMessage);
    }

    static RemotePolicy locked(String code, String message) {
        return new RemotePolicy(false, false, false, false, false,
                "", "", "", 45, "", "", "", "", "", false,
                0, "", code, message);
    }

    private static String encodeFeatures(JSONObject features) {
        StringBuilder wire = new StringBuilder();
        Iterator<String> keys = features.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!key.matches("[a-z][a-z0-9_]{1,63}")) continue;
            JSONObject feature = features.optJSONObject(key);
            if (feature == null) continue;
            wire.append(key)
                    .append('|').append(feature.optBoolean("enabled", false) ? '1' : '0')
                    .append('|').append(feature.optBoolean("locked", true) ? '1' : '0')
                    .append('\n');
        }
        return wire.toString();
    }
}
