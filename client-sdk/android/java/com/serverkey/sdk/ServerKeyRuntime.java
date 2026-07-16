package com.serverkey.sdk;

import android.content.Context;

/**
 * Small lifecycle facade for host applications. Network/session handling and
 * JNI policy delivery stay inside the SDK; the Activity only owns its license
 * input UI.
 */
public final class ServerKeyRuntime implements ServerKeyClient.Listener {
    public interface Listener {
        void onPolicy(RemotePolicy policy);
        void onActivationRequired(String message);
        void onConnectionState(String state, String message);
    }

    private final ServerKeyClient client;
    private final Listener listener;

    public static ServerKeyRuntime create(Context context,
                                          String baseUrl,
                                          String productToken,
                                          String projectId,
                                          String appVersion,
                                          Listener listener) {
        ServerKeyConfig config = ServerKeyConfig.builder(
                        baseUrl, productToken, projectId, appVersion)
                .offlineGraceSeconds(120)
                .timeouts(12_000, 15_000)
                .build();
        return new ServerKeyRuntime(context, config, listener);
    }

    public static ServerKeyRuntime create(Context context,
                                          ServerKeyConfig config,
                                          Listener listener) {
        return new ServerKeyRuntime(context, config, listener);
    }

    public static ServerKeyRuntime create(Context context,
                                          String connectionUri,
                                          String appVersion,
                                          Listener listener) {
        return new ServerKeyRuntime(context,
                ServerKeyConfig.fromConnectionUri(connectionUri, appVersion),
                listener);
    }

    private ServerKeyRuntime(Context context, ServerKeyConfig config,
                             Listener listener) {
        if (context == null || config == null || listener == null) {
            throw new IllegalArgumentException("Context, config, and listener are required.");
        }
        this.listener = listener;
        this.client = new ServerKeyClient(context.getApplicationContext(), config, this);
    }

    public void start() {
        NativeBridge.setConnectionState("connecting",
                "Đang kết nối ServerKey · Connecting to ServerKey...");
        client.start();
    }

    public void activate(String licenseKey) {
        client.activate(licenseKey);
    }

    public void logout() {
        client.logout();
    }

    public void stop() {
        client.stop();
    }

    @Override
    public void onPolicy(RemotePolicy policy) {
        NativeBridge.apply(policy);
        listener.onPolicy(policy);
    }

    @Override
    public void onActivationRequired(String message) {
        NativeBridge.setConnectionState("locked", message);
        listener.onActivationRequired(message);
    }

    @Override
    public void onConnectionState(String state, String message) {
        NativeBridge.setConnectionState(state, message);
        listener.onConnectionState(state, message);
    }
}
