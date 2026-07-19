package com.serverkey.sdk;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Iterator;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;

/**
 * The only Android platform file required by the ServerKey static SDK.
 * It owns no Activity or Android dialog. The linked native archive remains
 * the authoritative runtime/feature gate and optionally renders the standard
 * ServerKey lock/notification surfaces inside an existing IMGUI frame.
 */
public final class ServerKeyPlatform {
    public interface Listener {
        void onPolicy(Policy policy);
        void onActivationRequired(String message);
        void onConnectionState(String state, String message);
    }

    public static final class Policy {
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
        final String featuresWire;
        final String statusCode;
        final String statusMessage;

        private Policy(boolean sessionValid, boolean authorized, boolean menuEnabled,
                       boolean maintenanceMode, boolean autoUpdateEnabled,
                       String minimumVersion, String latestVersion, String updateUrl,
                       int heartbeatIntervalSeconds, String announcement,
                       String notificationId, String notificationTitle,
                       String notificationMessage, String notificationCreatedAt,
                       boolean notificationFresh, long configRevision,
                       String featuresWire, String statusCode, String statusMessage) {
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

        static Policy fromResponse(JSONObject response,
                                   String previousNotificationId,
                                   String previousNotificationTitle,
                                   String previousNotificationMessage,
                                   String previousNotificationCreatedAt) throws Exception {
            JSONObject config = response.optJSONObject("config");
            if (config == null) throw new IllegalStateException("Server response is missing config.");
            JSONObject features = response.optJSONObject("features");
            if (features == null) features = new JSONObject();
            int heartbeat = Math.max(15,
                    Math.min(3600, config.optInt("heartbeat_interval_seconds", 45)));

            String notificationId = safe(previousNotificationId);
            String notificationTitle = safe(previousNotificationTitle);
            String notificationMessage = safe(previousNotificationMessage);
            String notificationCreatedAt = safe(previousNotificationCreatedAt);
            boolean notificationFresh = false;
            JSONObject notification = response.optJSONObject("notification");
            if (notification != null) {
                String receivedId = notification.optString("id", "").trim();
                String receivedMessage = notification.optString("message", "").trim();
                if (!receivedId.isEmpty() && !receivedMessage.isEmpty()) {
                    notificationId = receivedId;
                    notificationTitle = notification.optString("title", "ServerKey").trim();
                    notificationMessage = receivedMessage;
                    notificationCreatedAt = notification.optString("created_at", "").trim();
                    notificationFresh = !receivedId.equals(safe(previousNotificationId));
                }
            }

            String announcement = "";
            String statusMessage = response.optString("authorization_message",
                    response.optString("message", "")).trim();
            return new Policy(
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

        static Policy locked(String code, String message) {
            return new Policy(false, false, false, false, false,
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

        private static String safe(String value) {
            return value == null ? "" : value;
        }
    }

    private static final int MAX_RESPONSE_CHARS = 256 * 1024;
    private final Config config;
    private final Listener listener;
    private final String deviceId;
    private final String deviceName;
    private final SecureStore sessionStore;
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private volatile boolean stopped;
    private volatile String sessionToken = "";
    private volatile String lastNotificationId = "";
    private volatile String lastNotificationTitle = "";
    private volatile String lastNotificationMessage = "";
    private volatile String lastNotificationCreatedAt = "";
    private volatile long lastSuccessfulContactElapsed;
    private ScheduledFuture<?> heartbeatFuture;

    public static ServerKeyPlatform create(Context context, String connectionUri,
                                           String appVersion, Listener listener) {
        return new ServerKeyPlatform(context,
                Config.fromConnectionUri(connectionUri, appVersion), listener);
    }

    private ServerKeyPlatform(Context context, Config config, Listener listener) {
        if (context == null || config == null || listener == null) {
            throw new IllegalArgumentException("Context, config, and listener are required.");
        }
        Context appContext = context.getApplicationContext();
        this.config = config;
        this.listener = listener;
        this.deviceId = createDeviceId(appContext, config.projectId);
        this.deviceName = getDeviceName(appContext);
        this.sessionStore = new SecureStore(appContext, config.projectId);
        NativeBridge.initialize(config.productToken);
    }

    public synchronized void start() {
        if (stopped) return;
        NativeBridge.setConnectionState("connecting",
                "Đang kết nối ServerKey · Connecting to ServerKey...");
        SessionRecord saved = sessionStore.load();
        if (saved == null) {
            postActivationRequired("Nhập license để kích hoạt · Enter a license to activate.");
            return;
        }
        sessionToken = saved.sessionToken;
        lastNotificationId = saved.lastNotificationId;
        lastNotificationTitle = saved.lastNotificationTitle;
        lastNotificationMessage = saved.lastNotificationMessage;
        lastNotificationCreatedAt = saved.lastNotificationCreatedAt;
        postConnectionState("connecting", "Đang xác minh phiên · Verifying saved session...");
        executor.execute(new Runnable() {
            @Override public void run() { performHeartbeat(true); }
        });
    }

    public void activate(String license) {
        final String normalized = license == null ? "" : license.trim();
        if (normalized.isEmpty()) {
            postActivationRequired("License không được để trống · License is required.");
            return;
        }
        postConnectionState("connecting", "Đang kích hoạt · Activating license...");
        executor.execute(new Runnable() {
            @Override public void run() { performActivation(normalized); }
        });
    }

    public void logout() {
        final String token = sessionToken;
        sessionToken = "";
        sessionStore.clear();
        if (!token.isEmpty() && !stopped) {
            executor.execute(new Runnable() {
                @Override public void run() {
                    try { postJson("/api/v1/client/logout", new JSONObject(), token); }
                    catch (Exception ignored) {}
                }
            });
        }
        publishPolicy(Policy.locked("logged_out", "Đã đăng xuất khỏi ServerKey."));
        postActivationRequired("Nhập license để đăng nhập lại · Enter a license to sign in again.");
    }

    public synchronized void stop() {
        if (stopped) return;
        stopped = true;
        if (heartbeatFuture != null) heartbeatFuture.cancel(false);
        executor.shutdownNow();
        NativeBridge.shutdown();
    }

    private void performActivation(String license) {
        try {
            JSONObject body = new JSONObject();
            body.put("token_string", config.productToken);
            body.put("key_string", license);
            body.put("hwid", deviceId);
            body.put("device_name", deviceName);
            body.put("project_id", config.projectId);
            body.put("app_version", config.appVersion);
            body.put("last_notification_id", lastNotificationId);
            HttpResult result = postJson("/api/v1/client/activate", body, "");
            if (result.code < 200 || result.code >= 300 ||
                    !result.body.optBoolean("success", false)) {
                String message = result.body.optString("message", "Kích hoạt license thất bại.");
                sessionToken = "";
                sessionStore.clear();
                publishPolicy(Policy.locked(
                        result.body.optString("code", "activation_failed"), message));
                postActivationRequired(message);
                return;
            }

            String token = result.body.optString("token", "").trim();
            if (token.isEmpty()) throw new IllegalStateException("Server did not return a session token.");
            sessionToken = token;
            lastSuccessfulContactElapsed = SystemClock.elapsedRealtime();
            Policy policy = Policy.fromResponse(result.body,
                    lastNotificationId, lastNotificationTitle,
                    lastNotificationMessage, lastNotificationCreatedAt);
            rememberNotification(policy);
            sessionStore.save(token, lastNotificationId,
                    lastNotificationTitle, lastNotificationMessage,
                    lastNotificationCreatedAt);
            publishPolicy(policy);
            postConnectionState(policy.authorized ? "online" : "locked",
                    policy.statusMessage.isEmpty() ? "Đã nhận policy từ ServerKey." : policy.statusMessage);
            scheduleHeartbeat(policy.heartbeatIntervalSeconds);
        } catch (Exception error) {
            handleNetworkFailure("Không thể kích hoạt: " + safeMessage(error));
            postActivationRequired("Không thể kết nối ServerKey. Kiểm tra mạng và thử lại.");
        }
    }

    private void performHeartbeat(boolean restoringSession) {
        if (stopped || sessionToken.isEmpty()) return;
        try {
            JSONObject body = new JSONObject();
            body.put("app_version", config.appVersion);
            body.put("device_name", deviceName);
            body.put("project_id", config.projectId);
            body.put("last_notification_id", lastNotificationId);
            HttpResult result = postJson("/api/v1/client/heartbeat", body, sessionToken);
            if (result.code == 401 || result.code == 403) {
                String message = result.body.optString("message",
                        "Phiên đã bị thu hồi hoặc hết hạn.");
                sessionToken = "";
                sessionStore.clear();
                publishPolicy(Policy.locked(
                        result.body.optString("code", "session_revoked"), message));
                postConnectionState("locked", message);
                postActivationRequired(message);
                return;
            }
            if (result.code < 200 || result.code >= 300 ||
                    !result.body.optBoolean("success", false)) {
                throw new IllegalStateException(result.body.optString("message", "Heartbeat failed."));
            }
            lastSuccessfulContactElapsed = SystemClock.elapsedRealtime();
            Policy policy = Policy.fromResponse(result.body,
                    lastNotificationId, lastNotificationTitle,
                    lastNotificationMessage, lastNotificationCreatedAt);
            rememberNotification(policy);
            publishPolicy(policy);
            postConnectionState(policy.authorized ? "online" : "locked",
                    policy.statusMessage.isEmpty() ? "ServerKey đã đồng bộ." : policy.statusMessage);
            scheduleHeartbeat(policy.heartbeatIntervalSeconds);
        } catch (Exception error) {
            handleNetworkFailure("Heartbeat lỗi: " + safeMessage(error));
            if (restoringSession && lastSuccessfulContactElapsed == 0) {
                postActivationRequired("Không xác minh được phiên đã lưu. Vui lòng thử lại khi có mạng.");
            }
            scheduleHeartbeat(30);
        }
    }

    private synchronized void scheduleHeartbeat(int intervalSeconds) {
        if (stopped || sessionToken.isEmpty()) return;
        if (heartbeatFuture != null) heartbeatFuture.cancel(false);
        int bounded = Math.max(15, Math.min(3600, intervalSeconds));
        long delay = Math.max(15, Math.round(bounded * (0.90 + Math.random() * 0.20)));
        heartbeatFuture = executor.schedule(new Runnable() {
            @Override public void run() { performHeartbeat(false); }
        }, delay, TimeUnit.SECONDS);
    }

    private void handleNetworkFailure(String message) {
        long last = lastSuccessfulContactElapsed;
        boolean graceExpired = last == 0 ||
                SystemClock.elapsedRealtime() - last > config.offlineGraceSeconds * 1000L;
        if (graceExpired) {
            publishPolicy(Policy.locked("offline", message));
            postConnectionState("offline", message);
        } else {
            postConnectionState("degraded", message);
        }
    }

    private void rememberNotification(Policy policy) {
        if (policy.notificationId.isEmpty() ||
                policy.notificationId.equals(lastNotificationId)) return;
        lastNotificationId = policy.notificationId;
        lastNotificationTitle = policy.notificationTitle;
        lastNotificationMessage = policy.notificationMessage;
        lastNotificationCreatedAt = policy.notificationCreatedAt;
        if (!sessionToken.isEmpty()) {
            try {
                sessionStore.save(sessionToken, lastNotificationId,
                        lastNotificationTitle, lastNotificationMessage,
                        lastNotificationCreatedAt);
            } catch (Exception ignored) {}
        }
    }

    private HttpResult postJson(String path, JSONObject payload, String bearerToken) throws Exception {
        URL url = new URL(config.baseUrl + path);
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(config.connectTimeoutMs);
            connection.setReadTimeout(config.readTimeoutMs);
            connection.setUseCaches(false);
            connection.setDoOutput(true);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Cache-Control", "no-store");
            if (bearerToken != null && !bearerToken.isEmpty()) {
                connection.setRequestProperty("Authorization", "Bearer " + bearerToken);
            }
            byte[] requestBody = payload.toString().getBytes(StandardCharsets.UTF_8);
            try {
                connection.setFixedLengthStreamingMode(requestBody.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(requestBody);
                }
            } finally {
                Arrays.fill(requestBody, (byte) 0);
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 400
                    ? connection.getInputStream() : connection.getErrorStream();
            String response = readLimited(stream);
            return new HttpResult(status,
                    response.isEmpty() ? new JSONObject() : new JSONObject(response));
        } finally {
            connection.disconnect();
        }
    }

    private static String readLimited(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            char[] buffer = new char[4096];
            int count;
            while ((count = reader.read(buffer)) != -1) {
                if (output.length() + count > MAX_RESPONSE_CHARS) {
                    throw new IllegalStateException("Server response exceeds the size limit.");
                }
                output.append(buffer, 0, count);
            }
        }
        return output.toString();
    }

    private void publishPolicy(final Policy policy) {
        mainHandler.post(new Runnable() {
            @Override public void run() {
                if (stopped) return;
                NativeBridge.apply(policy);
                listener.onPolicy(policy);
            }
        });
    }

    private void postActivationRequired(final String message) {
        mainHandler.post(new Runnable() {
            @Override public void run() {
                if (stopped) return;
                NativeBridge.setConnectionState("locked", message);
                listener.onActivationRequired(message);
            }
        });
    }

    private void postConnectionState(final String state, final String message) {
        mainHandler.post(new Runnable() {
            @Override public void run() {
                if (stopped) return;
                NativeBridge.setConnectionState(state, message);
                listener.onConnectionState(state, message);
            }
        });
    }

    private static String createDeviceId(Context context, String projectId) {
        String androidId = Settings.Secure.getString(
                context.getContentResolver(), Settings.Secure.ANDROID_ID);
        if (androidId == null || androidId.trim().isEmpty()) androidId = "unavailable";
        String material = projectId + "|" + context.getPackageName() + "|" + androidId;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(material.getBytes(StandardCharsets.UTF_8));
            StringBuilder output = new StringBuilder(digest.length * 2);
            for (byte value : digest) output.append(String.format("%02x", value & 0xff));
            return output.toString();
        } catch (Exception error) {
            throw new IllegalStateException("Could not create device identity.", error);
        }
    }

    private static String getDeviceName(Context context) {
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
        if (!manufacturer.isEmpty() &&
                !model.toLowerCase().startsWith(manufacturer.toLowerCase())) {
            model = manufacturer + " " + model;
        }
        return limit(model.isEmpty() ? "Android device" : model, 120);
    }

    private static String limit(String value, int maximum) {
        return value.length() <= maximum ? value : value.substring(0, maximum);
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty()
                ? error.getClass().getSimpleName() : message.trim();
    }

    private static final class Config {
        final String baseUrl;
        final String productToken;
        final String projectId;
        final String appVersion;
        final int connectTimeoutMs = 12_000;
        final int readTimeoutMs = 15_000;
        final int offlineGraceSeconds = 120;

        private Config(String baseUrl, String productToken,
                       String projectId, String appVersion) {
            this.baseUrl = trimTrailingSlash(baseUrl);
            this.productToken = safeValue(productToken);
            this.projectId = safeValue(projectId);
            this.appVersion = safeValue(appVersion);
            Uri url = Uri.parse(this.baseUrl);
            if (!"https".equalsIgnoreCase(url.getScheme()) || url.getHost() == null) {
                throw new IllegalArgumentException("ServerKey base URL must use HTTPS.");
            }
            if (this.productToken.isEmpty() || this.projectId.isEmpty() ||
                    this.appVersion.isEmpty()) {
                throw new IllegalArgumentException("ServerKey token, project, and app version are required.");
            }
        }

        static Config fromConnectionUri(String connectionUri, String appVersion) {
            Uri uri = Uri.parse(safeValue(connectionUri));
            if (!"serverkey".equalsIgnoreCase(uri.getScheme()) ||
                    !"connect".equalsIgnoreCase(uri.getHost()) ||
                    !"1".equals(uri.getQueryParameter("protocol"))) {
                throw new IllegalArgumentException("Invalid ServerKey connection URI.");
            }
            return new Config(uri.getQueryParameter("base_url"),
                    uri.getQueryParameter("product_token"),
                    uri.getQueryParameter("project_id"), appVersion);
        }

        private static String trimTrailingSlash(String value) {
            String result = safeValue(value);
            while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
            return result;
        }

        private static String safeValue(String value) {
            return value == null ? "" : value.trim();
        }
    }

    private static final class HttpResult {
        final int code;
        final JSONObject body;
        HttpResult(int code, JSONObject body) {
            this.code = code;
            this.body = body;
        }
    }

    private static final class SessionRecord {
        final String sessionToken;
        final String lastNotificationId;
        final String lastNotificationTitle;
        final String lastNotificationMessage;
        final String lastNotificationCreatedAt;

        SessionRecord(String sessionToken, String lastNotificationId,
                      String lastNotificationTitle, String lastNotificationMessage,
                      String lastNotificationCreatedAt) {
            this.sessionToken = sessionToken;
            this.lastNotificationId = lastNotificationId;
            this.lastNotificationTitle = lastNotificationTitle;
            this.lastNotificationMessage = lastNotificationMessage;
            this.lastNotificationCreatedAt = lastNotificationCreatedAt;
        }
    }

    private static final class SecureStore {
        private static final String KEYSTORE = "AndroidKeyStore";
        private final SharedPreferences preferences;
        private final String keyAlias;

        SecureStore(Context context, String projectId) {
            String safeProject = projectId.replaceAll("[^A-Za-z0-9_.-]", "_");
            preferences = context.getSharedPreferences(
                    "serverkey_secure_" + safeProject, Context.MODE_PRIVATE);
            keyAlias = "serverkey.session." + context.getPackageName() + "." + safeProject;
        }

        synchronized void save(String token, String notificationId, String notificationTitle,
                               String notificationMessage, String notificationCreatedAt) throws Exception {
            JSONObject value = new JSONObject();
            value.put("session_token", token);
            value.put("last_notification_id", Policy.safe(notificationId));
            value.put("last_notification_title", Policy.safe(notificationTitle));
            value.put("last_notification_message", Policy.safe(notificationMessage));
            value.put("last_notification_created_at", Policy.safe(notificationCreatedAt));
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8));
            preferences.edit()
                    .putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                    .apply();
        }

        synchronized SessionRecord load() {
            String ciphertext = preferences.getString("ciphertext", "");
            String iv = preferences.getString("iv", "");
            if (ciphertext.isEmpty() || iv.isEmpty()) return null;
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(),
                        new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
                JSONObject value = new JSONObject(new String(cipher.doFinal(
                        Base64.decode(ciphertext, Base64.NO_WRAP)), StandardCharsets.UTF_8));
                String token = value.optString("session_token", "").trim();
                if (token.isEmpty()) return null;
                return new SessionRecord(token,
                        value.optString("last_notification_id", "").trim(),
                        value.optString("last_notification_title", "").trim(),
                        value.optString("last_notification_message", "").trim(),
                        value.optString("last_notification_created_at", "").trim());
            } catch (Exception error) {
                clear();
                return null;
            }
        }

        synchronized void clear() {
            preferences.edit().clear().apply();
        }

        private SecretKey getOrCreateKey() throws Exception {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            KeyStore.Entry existing = keyStore.getEntry(keyAlias, null);
            if (existing instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
            }
            KeyGenerator generator = KeyGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
            generator.init(new KeyGenParameterSpec.Builder(
                    keyAlias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setUserAuthenticationRequired(false)
                    .build());
            return generator.generateKey();
        }
    }
}

/** Fixed-package JNI declarations. The implementations live in libserverkey_core.a. */
final class NativeBridge {
    private NativeBridge() {}

    static void initialize(String productToken) {
        try {
            if (!nativeInitialize(productToken == null ? "" : productToken)) {
                throw new IllegalStateException("ServerKey static core rejected the product token.");
            }
        } catch (UnsatisfiedLinkError error) {
            throw linkageError(error);
        }
    }

    static void apply(ServerKeyPlatform.Policy policy) {
        try {
            nativeApplyPolicy(policy.authorized, policy.menuEnabled,
                    policy.maintenanceMode, policy.autoUpdateEnabled,
                    policy.minimumVersion, policy.latestVersion, policy.updateUrl,
                    policy.announcement, policy.notificationId, policy.notificationTitle,
                    policy.notificationMessage, policy.notificationCreatedAt,
                    policy.notificationFresh, policy.configRevision, policy.featuresWire,
                    policy.statusCode, policy.statusMessage);
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

    static void shutdown() {
        try {
            nativeShutdown();
        } catch (UnsatisfiedLinkError error) {
            throw linkageError(error);
        }
    }

    private static IllegalStateException linkageError(UnsatisfiedLinkError cause) {
        return new IllegalStateException(
                "Link libserverkey_core.a and retain its NativeBridge JNI entrypoint before ServerKeyPlatform starts.", cause);
    }

    private static native boolean nativeInitialize(String productToken);
    private static native void nativeShutdown();
    private static native void nativeSetConnectionState(String state, String message);
    private static native void nativeApplyPolicy(
            boolean authorized, boolean menuEnabled, boolean maintenanceMode,
            boolean autoUpdateEnabled, String minimumVersion, String latestVersion,
            String updateUrl, String announcement, String notificationId,
            String notificationTitle, String notificationMessage,
            String notificationCreatedAt, boolean notificationFresh,
            long configRevision, String featuresWire,
            String statusCode, String statusMessage);
}
