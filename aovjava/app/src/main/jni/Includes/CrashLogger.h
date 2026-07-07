#pragma once

// CrashLogger.h
// Native crash logger for non-root devices.
// Writes a minimal report to external Documents/<package>/crash_logs/.

#include <jni.h>

// Install SIGSEGV/SIGABRT handlers.
// Pass a valid JNIEnv once (e.g. from JNI_OnLoad or a native Init call).
void CrashLogger_Install(JNIEnv* env);
