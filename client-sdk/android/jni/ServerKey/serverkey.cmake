if(NOT ANDROID)
    message(FATAL_ERROR "ServerKey V2 supports Android NDK targets only")
endif()

if(NOT ANDROID_ABI AND CMAKE_ANDROID_ARCH_ABI)
    set(ANDROID_ABI "${CMAKE_ANDROID_ARCH_ABI}")
endif()

if(NOT ANDROID_ABI MATCHES "^(arm64-v8a|armeabi-v7a)$")
    message(FATAL_ERROR "ServerKey V2 has no archive for ABI: ${ANDROID_ABI}")
endif()

set(SERVERKEY_SDK_ROOT "${CMAKE_CURRENT_LIST_DIR}")

if(NOT TARGET serverkey_core)
    add_library(serverkey_core STATIC IMPORTED)
    set_target_properties(serverkey_core PROPERTIES
        IMPORTED_LOCATION "${SERVERKEY_SDK_ROOT}/lib/${ANDROID_ABI}/libserverkey_core.a"
        INTERFACE_INCLUDE_DIRECTORIES "${SERVERKEY_SDK_ROOT}/include")
endif()

function(serverkey_link target_name)
    if(NOT TARGET "${target_name}")
        message(FATAL_ERROR "serverkey_link target does not exist: ${target_name}")
    endif()
    target_compile_features("${target_name}" PRIVATE cxx_std_17)
    # Retain the JNI translation unit without forcing optional IMGUI objects
    # into non-IMGUI clients.
    target_link_options("${target_name}" PRIVATE
        "-Wl,-u,Java_com_serverkey_sdk_NativeBridge_nativeInitialize")
    target_link_libraries("${target_name}" PRIVATE serverkey_core)
endfunction()
