LOCAL_PATH := $(call my-dir)
MAIN_LOCAL_PATH := $(call my-dir)
include $(CLEAR_VARS)

LOCAL_MODULE := libdobby
LOCAL_SRC_FILES := $(LOCAL_PATH)/libraries/$(TARGET_ARCH_ABI)/libdobby.a
LOCAL_SRC_FILES := libraries/$(TARGET_ARCH_ABI)/libdobby.a
include $(PREBUILT_STATIC_LIBRARY)
include $(CLEAR_VARS)

LOCAL_MODULE    := wtuananhVIP

LOCAL_CFLAGS := -w -s -Wno-error=format-security -fvisibility=hidden -fpermissive -fexceptions
LOCAL_CPPFLAGS := -w -s -Wno-error=format-security -fvisibility=hidden -Werror -std=c++17
LOCAL_CPPFLAGS += -Wno-error=c++11-narrowing -fpermissive -Wall -fexceptions
LOCAL_LDFLAGS += -Wl,--gc-sections,--strip-all,-llog
LOCAL_LDLIBS := -lz -landroid -lEGL -lGLESv2
LOCAL_ARM_MODE := arm



LOCAL_C_INCLUDES += $(LOCAL_PATH)
LOCAL_C_INCLUDES += $(LOCAL_PATH)/Includes
LOCAL_C_INCLUDES += $(LOCAL_PATH)/ImGui
LOCAL_C_INCLUDES += $(LOCAL_PATH)/ImGui/backends
LOCAL_C_INCLUDES += $(LOCAL_PATH)/AutoUpdate
LOCAL_C_INCLUDES += $(LOCAL_PATH)/Features
LOCAL_C_INCLUDES += $(LOCAL_PATH)/xDL

LOCAL_STATIC_LIBRARIES := libdobby

LOCAL_SRC_FILES := main.cpp \
	ImGui/imgui.cpp \
    ImGui/imgui_draw.cpp \
    ImGui/imgui_widgets.cpp \
    ImGui/imgui_tables.cpp \
    ImGui/backends/imgui_impl_opengl3.cpp \
    ImGui/backends/imgui_impl_android.cpp \
    Substrate/SubstrateDebug.cpp \
	Substrate/SubstrateHook.cpp \
	Substrate/SubstratePosixMemory.cpp \
    KittyMemory/KittyIOFile.cpp \
    KittyMemory/KittyMemory.cpp \
    KittyMemory/KittyPtrValidator.cpp \
    KittyMemory/KittyScanner.cpp \
    KittyMemory/KittyUtils.cpp \
    KittyMemory/MemoryBackup.cpp \
    KittyMemory/MemoryPatch.cpp \
    And64InlineHook/And64InlineHook.cpp \
    Features/AovHooks.cpp \
    Features/EspGlobals.cpp \
    Includes/CrashLogger.cpp \
    Includes/Utils.cpp \
    xDL/xdl.c \
    xDL/xdl_iterate.c \
    xDL/xdl_linker.c \
    xDL/xdl_lzma.c \
    xDL/xdl_util.c \
    
include $(BUILD_SHARED_LIBRARY)
