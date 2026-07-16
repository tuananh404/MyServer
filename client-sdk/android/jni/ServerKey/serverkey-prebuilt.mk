# Include this file after LOCAL_PATH is defined and before the host module.
include $(CLEAR_VARS)
LOCAL_MODULE := serverkey_core
LOCAL_SRC_FILES := ServerKey/lib/$(TARGET_ARCH_ABI)/libserverkey_core.a
LOCAL_EXPORT_C_INCLUDES := $(LOCAL_PATH)/ServerKey/include
include $(PREBUILT_STATIC_LIBRARY)
