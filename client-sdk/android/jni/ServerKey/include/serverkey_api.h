#pragma once

#include <stddef.h>
#include <stdint.h>

#if defined(__GNUC__)
#define SERVERKEY_API __attribute__((visibility("default")))
#else
#define SERVERKEY_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define SERVERKEY_NATIVE_API_VERSION 1u
#define SERVERKEY_MAX_FEATURES 512u

typedef enum ServerKeyResult {
    SERVERKEY_RESULT_OK = 0,
    SERVERKEY_RESULT_INVALID_ARGUMENT = -1,
    SERVERKEY_RESULT_NOT_INITIALIZED = -2,
    SERVERKEY_RESULT_INCOMPATIBLE_API = -3,
    SERVERKEY_RESULT_STALE_POLICY = -4,
    SERVERKEY_RESULT_INTERNAL_ERROR = -5
} ServerKeyResult;

typedef enum ServerKeyState {
    SERVERKEY_STATE_BOOT_LOCKED = 0,
    SERVERKEY_STATE_ACTIVATION_REQUIRED = 1,
    SERVERKEY_STATE_CONNECTING = 2,
    SERVERKEY_STATE_AUTHORIZED = 3,
    SERVERKEY_STATE_OFFLINE_GRACE = 4,
    SERVERKEY_STATE_LOCKED = 5,
    SERVERKEY_STATE_STOPPED = 6
} ServerKeyState;

typedef struct ServerKeyFeatureInput {
    const char* key;
    uint8_t enabled;
    uint8_t locked;
    uint8_t reserved[2];
} ServerKeyFeatureInput;

typedef struct ServerKeyPolicyInput {
    uint32_t struct_size;
    uint32_t api_version;
    uint8_t authorized;
    uint8_t menu_enabled;
    uint8_t maintenance_mode;
    uint8_t auto_update_enabled;
    uint8_t notification_fresh;
    uint8_t reserved[3];
    uint64_t revision;
    const char* minimum_version;
    const char* latest_version;
    const char* update_url;
    const char* announcement;
    const char* notification_id;
    const char* notification_title;
    const char* notification_message;
    const char* notification_created_at;
    const char* status_code;
    const char* status_message;
    const ServerKeyFeatureInput* features;
    uint32_t feature_count;
} ServerKeyPolicyInput;

typedef struct ServerKeySnapshot {
    uint32_t struct_size;
    uint32_t api_version;
    ServerKeyState state;
    uint8_t initialized;
    uint8_t authorized;
    uint8_t runtime_allowed;
    uint8_t menu_enabled;
    uint8_t maintenance_mode;
    uint8_t auto_update_enabled;
    uint8_t notification_fresh;
    uint8_t reserved[1];
    uint32_t feature_count;
    uint64_t revision;
    char connection_state[32];
    char status_code[64];
    char status_message[256];
    char minimum_version[32];
    char latest_version[32];
    char update_url[512];
    char announcement[768];
    char notification_id[64];
    char notification_title[128];
    char notification_message[768];
    char notification_created_at[64];
} ServerKeySnapshot;

typedef void (*ServerKeyStateCallback)(const ServerKeySnapshot* snapshot, void* user_data);

typedef struct ServerKeyCallbacks {
    uint32_t struct_size;
    uint32_t api_version;
    void* user_data;
    ServerKeyStateCallback on_policy_changed;
    ServerKeyStateCallback on_runtime_authorized;
    ServerKeyStateCallback on_runtime_revoked;
    ServerKeyStateCallback on_notification;
} ServerKeyCallbacks;

SERVERKEY_API uint32_t ServerKey_GetApiVersion(void);
SERVERKEY_API ServerKeyResult ServerKey_Initialize(const char* product_token);
SERVERKEY_API void ServerKey_Shutdown(void);
SERVERKEY_API uint8_t ServerKey_IsInitialized(void);
SERVERKEY_API uint32_t ServerKey_CopyProductToken(char* output, uint32_t output_size);

SERVERKEY_API ServerKeyResult ServerKey_SetCallbacks(const ServerKeyCallbacks* callbacks);
SERVERKEY_API ServerKeyResult ServerKey_ApplyPolicy(const ServerKeyPolicyInput* policy);
SERVERKEY_API ServerKeyResult ServerKey_SetConnectionState(
        ServerKeyState state, const char* connection_state,
        const char* status_code, const char* status_message);

SERVERKEY_API uint8_t ServerKey_RuntimeAllowed(void);
SERVERKEY_API uint8_t ServerKey_FeatureEnabled(const char* feature_key);
SERVERKEY_API uint8_t ServerKey_FeatureLocked(const char* feature_key);
SERVERKEY_API ServerKeyResult ServerKey_GetSnapshot(ServerKeySnapshot* output);

// Run from the host UI/render thread. Callbacks are never invoked from the
// network thread that applies a policy.
SERVERKEY_API uint32_t ServerKey_PumpEvents(uint32_t max_events);

#ifdef __cplusplus
}
#endif
