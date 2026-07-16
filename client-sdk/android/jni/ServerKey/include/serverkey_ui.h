#pragma once

#include "serverkey_api.h"

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SERVERKEY_UI_API_VERSION 1u

typedef enum ServerKeyUiSurface {
    SERVERKEY_UI_SURFACE_LOCK_PANEL = 1,
    SERVERKEY_UI_SURFACE_NOTIFICATION_PAGE = 2,
    SERVERKEY_UI_SURFACE_NOTIFICATION_OVERLAY = 3
} ServerKeyUiSurface;

typedef enum ServerKeyUiLanguage {
    SERVERKEY_UI_LANGUAGE_ENGLISH = 0,
    SERVERKEY_UI_LANGUAGE_VIETNAMESE = 1
} ServerKeyUiLanguage;

typedef enum ServerKeyUiFlags {
    SERVERKEY_UI_FLAG_NONE = 0,
    SERVERKEY_UI_FLAG_VISIBLE = 1 << 0,
    SERVERKEY_UI_FLAG_UNREAD = 1 << 1,
    SERVERKEY_UI_FLAG_OPEN_NOTIFICATION = 1 << 2
} ServerKeyUiFlags;

typedef struct ServerKeyUiOptions {
    uint32_t struct_size;
    uint32_t api_version;
    ServerKeyUiLanguage language;
    float screen_width;
    float screen_height;
    float scale;
} ServerKeyUiOptions;

typedef struct ServerKeyUiResult {
    uint32_t struct_size;
    uint32_t api_version;
    uint32_t flags;
    int32_t touch_x;
    int32_t touch_y;
    int32_t touch_width;
    int32_t touch_height;
} ServerKeyUiResult;

// Call only between ImGui::NewFrame() and ImGui::Render() on the host render
// thread. The SDK owns all lock/notification visual state and animation.
SERVERKEY_API ServerKeyResult ServerKeyUi_Draw(
        ServerKeyUiSurface surface,
        const ServerKeyUiOptions* options,
        ServerKeyUiResult* result);

SERVERKEY_API uint8_t ServerKeyUi_HasUnreadNotification(void);
SERVERKEY_API ServerKeyResult ServerKeyUi_GetLastResult(ServerKeyUiResult* result);
SERVERKEY_API void ServerKeyUi_Reset(void);

#ifdef __cplusplus
}
#endif
