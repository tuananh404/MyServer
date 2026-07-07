#pragma once
//
//  AnogsKiller.h v3.2 — Anti-cheat file neutralization
//  Runs entirely on a detached background thread.
//  Zero dependency on ImGui, hooks, or game logic.
//
//  Dual logging: logcat + file on external storage.
//  Log file: /storage/emulated/0/Documents/<package>/anogs_logs/
//
//  Target: ONLY libanogs.so — file-based kill only.
//  Logic: same as original code — find file path via libil2cpp.so maps,
//         then delete libanogs.so from disk. Next game restart it won't load.
//

#include <cstdio>
#include <cstring>
#include <cstdarg>
#include <ctime>
#include <string>
#include <set>
#include <thread>
#include <atomic>
#include <mutex>
#include <unistd.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <errno.h>

#include "Logger.h"

namespace AnogsKiller {

// ── Configuration ──────────────────────────────────────────────
static constexpr const char* ANOGS_LIB_NAME   = "libanogs.so";
static constexpr int  POLL_INTERVAL_MS         = 500;
static constexpr int  INITIAL_WAIT_SEC         = 2;
static constexpr int  MONITOR_DURATION_SEC     = 120;

// ── Internal state ─────────────────────────────────────────────
static std::atomic<bool> s_running{false};
static std::atomic<int>  s_killCount{0};
static std::mutex        s_logMutex;
static std::string       s_logFilePath;
static int               s_logFd = -1;

// ══════════════════════════════════════════════════════════════
//  FILE LOGGER
// ══════════════════════════════════════════════════════════════

static void _mkdirs(const char* path) {
    if (!path || !path[0]) return;
    char tmp[1024];
    strncpy(tmp, path, sizeof(tmp) - 1);
    tmp[sizeof(tmp) - 1] = '\0';
    size_t len = strlen(tmp);
    for (size_t i = 1; i < len; i++) {
        if (tmp[i] == '/') {
            tmp[i] = '\0';
            mkdir(tmp, 0775);
            tmp[i] = '/';
        }
    }
    mkdir(tmp, 0775);
}

static void _getProcessName(char* out, size_t n) {
    if (!out || n == 0) return;
    out[0] = '\0';
    int fd = open("/proc/self/cmdline", O_RDONLY);
    if (fd < 0) { strncpy(out, "unknown", n - 1); out[n-1] = '\0'; return; }
    ssize_t r = read(fd, out, n - 1);
    close(fd);
    if (r <= 0) { strncpy(out, "unknown", n - 1); out[n-1] = '\0'; return; }
    out[r] = '\0';
    for (ssize_t i = 0; i < r; i++) {
        if (out[i] == '\0') break;
        if (out[i] == ':') { out[i] = '\0'; break; }
    }
}

static void _formatTime(char* out, size_t n, bool forFilename) {
    if (!out || n == 0) return;
    std::time_t t = std::time(nullptr);
    std::tm tm;
    localtime_r(&t, &tm);
    if (forFilename) {
        snprintf(out, n, "%04d_%02d_%02d-%02d_%02d_%02d",
                 tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday,
                 tm.tm_hour, tm.tm_min, tm.tm_sec);
    } else {
        snprintf(out, n, "%04d-%02d-%02d %02d:%02d:%02d",
                 tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday,
                 tm.tm_hour, tm.tm_min, tm.tm_sec);
    }
}

static bool openLogFile() {
    char pkg[256];
    _getProcessName(pkg, sizeof(pkg));
    char ts[64];
    _formatTime(ts, sizeof(ts), true);

    char dir[512];
    snprintf(dir, sizeof(dir), "/storage/emulated/0/Documents/%s/anogs_logs", pkg);
    _mkdirs(dir);

    char path[768];
    snprintf(path, sizeof(path), "%s/anogs_%s.log", dir, ts);

    int fd = open(path, O_CREAT | O_WRONLY | O_APPEND, 0644);
    if (fd < 0) {
        snprintf(dir, sizeof(dir), "/storage/emulated/0/Android/data/%s/files/anogs_logs", pkg);
        _mkdirs(dir);
        snprintf(path, sizeof(path), "%s/anogs_%s.log", dir, ts);
        fd = open(path, O_CREAT | O_WRONLY | O_APPEND, 0644);
    }

    if (fd >= 0) {
        s_logFd = fd;
        s_logFilePath = path;
        return true;
    }
    return false;
}

static void closeLogFile() {
    if (s_logFd >= 0) { close(s_logFd); s_logFd = -1; }
}

__attribute__((format(printf, 2, 3)))
static void LOG(int level, const char* fmt, ...) {
    char msg[1024];
    va_list args;
    va_start(args, fmt);
    vsnprintf(msg, sizeof(msg), fmt, args);
    va_end(args);

    __android_log_print(level, "AnogsKiller", "%s", msg);

    std::lock_guard<std::mutex> lock(s_logMutex);
    if (s_logFd >= 0) {
        char ts[32];
        _formatTime(ts, sizeof(ts), false);
        const char* lvl = "I";
        switch (level) {
            case ANDROID_LOG_DEBUG: lvl = "D"; break;
            case ANDROID_LOG_INFO:  lvl = "I"; break;
            case ANDROID_LOG_WARN:  lvl = "W"; break;
            case ANDROID_LOG_ERROR: lvl = "E"; break;
        }
        char line[1200];
        int len = snprintf(line, sizeof(line), "[%s] [%s] %s\n", ts, lvl, msg);
        if (len > 0) {
            (void)write(s_logFd, line, (size_t)len);
            fsync(s_logFd);
        }
    }
}

#define AK_LOGI(...) LOG(ANDROID_LOG_INFO,  __VA_ARGS__)
#define AK_LOGW(...) LOG(ANDROID_LOG_WARN,  __VA_ARGS__)
#define AK_LOGE(...) LOG(ANDROID_LOG_ERROR, __VA_ARGS__)

// ══════════════════════════════════════════════════════════════
//  CORE — Find libanogs.so path, delete it from disk
// ══════════════════════════════════════════════════════════════

// Collect all unique directories from /proc/self/maps containing .so files
static std::set<std::string> collectLibDirs() {
    std::set<std::string> dirs;
    FILE* fp = fopen("/proc/self/maps", "r");
    if (!fp) return dirs;

    char line[1024];
    while (fgets(line, sizeof(line), fp)) {
        char pathBuf[512] = {};
        unsigned long s, e, off, ino;
        char p[8] = {}, d[32] = {};
        int n = sscanf(line, "%lx-%lx %4s %lx %31s %lu %511[^\n]",
                        &s, &e, p, &off, d, &ino, pathBuf);
        if (n < 7) continue;
        std::string path(pathBuf);
        while (!path.empty() && path[0] == ' ') path.erase(0, 1);
        if (path.empty() || path[0] != '/') continue;
        if (path.find(".so") == std::string::npos) continue;
        auto pos = path.rfind('/');
        if (pos != std::string::npos) {
            dirs.insert(path.substr(0, pos));
        }
    }
    fclose(fp);
    return dirs;
}

// Wait for libil2cpp.so to appear in maps
static bool waitForIl2cpp(int maxWaitMs) {
    int cycles = 0;
    int maxCycles = maxWaitMs / POLL_INTERVAL_MS;

    while (s_running.load() && cycles < maxCycles) {
        FILE* fp = fopen("/proc/self/maps", "r");
        if (fp) {
            char line[1024];
            while (fgets(line, sizeof(line), fp)) {
                if (strstr(line, "libil2cpp.so")) {
                    fclose(fp);
                    AK_LOGI("[Phase 1] libil2cpp.so FOUND");
                    return true;
                }
            }
            fclose(fp);
        }
        if (cycles > 0 && cycles % 20 == 0) {
            AK_LOGI("[Phase 1] Still waiting... (%d/%d)", cycles, maxCycles);
        }
        usleep(POLL_INTERVAL_MS * 1000);
        cycles++;
    }
    return false;
}

static long getFileSize(const std::string& path) {
    struct stat st;
    if (stat(path.c_str(), &st) == 0) return (long)st.st_size;
    return -1;
}

static bool fileExistsOnDisk(const std::string& path) {
    struct stat st;
    return (stat(path.c_str(), &st) == 0);
}

// Delete libanogs.so — same logic as original code
static bool deleteFile(const std::string& path) {
    long sz = getFileSize(path);

    if (sz < 0) {
        AK_LOGI("  File not found: %s", path.c_str());
        return false;
    }

    if (sz == 0) {
        AK_LOGI("  Already empty: %s", path.c_str());
        return true; // Already neutralized
    }

    AK_LOGI("  Target: %s (%ld bytes)", path.c_str(), sz);

    // Strategy A: Truncate to 0 bytes
    int fd = open(path.c_str(), O_WRONLY | O_TRUNC);
    if (fd >= 0) {
        close(fd);
        AK_LOGI("  Truncate SUCCESS ✓");
        s_killCount++;
        return true;
    }
    AK_LOGW("  Truncate FAILED: %s", strerror(errno));

    // Strategy B: Unlink
    if (unlink(path.c_str()) == 0) {
        AK_LOGI("  Unlink SUCCESS ✓");
        s_killCount++;
        return true;
    }
    AK_LOGW("  Unlink FAILED: %s", strerror(errno));

    // Strategy C: Overwrite with empty file
    fd = open(path.c_str(), O_WRONLY | O_TRUNC | O_CREAT, 0644);
    if (fd >= 0) {
        close(fd); // Just create empty file
        AK_LOGI("  Overwrite empty SUCCESS ✓");
        s_killCount++;
        return true;
    }
    AK_LOGE("  ALL strategies FAILED: %s", strerror(errno));
    return false;
}

// ══════════════════════════════════════════════════════════════
//  MAIN WORKER THREAD
// ══════════════════════════════════════════════════════════════

static void workerThread() {
    if (openLogFile()) {
        AK_LOGI("========================================");
        AK_LOGI("  AnogsKiller v3.2 — File Kill Only");
        AK_LOGI("  Target: libanogs.so");
        AK_LOGI("  PID: %d  TID: %d", (int)getpid(), (int)gettid());
        AK_LOGI("  Log: %s", s_logFilePath.c_str());
        AK_LOGI("========================================");
    }

    AK_LOGI("Waiting %ds...", INITIAL_WAIT_SEC);
    sleep(INITIAL_WAIT_SEC);

    // ── Phase 1: Wait for libil2cpp.so ────────────────────────
    AK_LOGI("[Phase 1] Waiting for libil2cpp.so...");
    if (!waitForIl2cpp(60000)) {
        AK_LOGE("[Phase 1] TIMEOUT. Aborting.");
        closeLogFile();
        s_running.store(false);
        return;
    }

    // ── Phase 2: Find and delete libanogs.so ──────────────────
    AK_LOGI("[Phase 2] Scanning all lib directories for libanogs.so...");

    auto dirs = collectLibDirs();
    AK_LOGI("  Found %zu directories", dirs.size());

    int found = 0;
    for (auto& dir : dirs) {
        std::string anogsPath = dir + "/" + ANOGS_LIB_NAME;
        if (fileExistsOnDisk(anogsPath)) {
            found++;
            AK_LOGI("  [%d] %s", found, dir.c_str());
            deleteFile(anogsPath);
        }
    }

    if (found == 0) {
        AK_LOGI("  libanogs.so not found in any directory");
    }

    AK_LOGI("[Phase 2] Result: %d files killed", s_killCount.load());

    // ── Phase 3: Monitor for re-extraction ────────────────────
    //  Game might re-extract libanogs.so from APK/OBB during gameplay
    AK_LOGI("[Phase 3] Monitoring for respawn (%ds)...", MONITOR_DURATION_SEC);
    auto startTime = std::chrono::steady_clock::now();
    int respawnCount = 0;

    while (s_running.load()) {
        auto elapsed = std::chrono::steady_clock::now() - startTime;
        int sec = (int)std::chrono::duration_cast<std::chrono::seconds>(elapsed).count();
        if (sec >= MONITOR_DURATION_SEC) break;

        for (auto& dir : dirs) {
            std::string path = dir + "/" + ANOGS_LIB_NAME;
            long sz = getFileSize(path);
            if (sz > 0) {
                respawnCount++;
                AK_LOGW("[Phase 3] RESPAWN #%d at +%ds: %s (%ld bytes)",
                         respawnCount, sec, path.c_str(), sz);
                deleteFile(path);
            }
        }

        sleep(3);
    }

    // ── Summary ──────────────────────────────────────────────
    AK_LOGI("========================================");
    AK_LOGI("  Session Complete");
    AK_LOGI("  Files killed:    %d", s_killCount.load());
    AK_LOGI("  Respawns caught: %d", respawnCount);
    AK_LOGI("  Status: %s", s_killCount.load() > 0 ? "SUCCESS — restart game to take effect" : "NOT FOUND");
    AK_LOGI("========================================");

    closeLogFile();
    s_running.store(false);
}

// ── Public API ─────────────────────────────────────────────────

inline void Start() {
    bool expected = false;
    if (!s_running.compare_exchange_strong(expected, true)) {
        LOGI("[AnogsKiller] Already running");
        return;
    }
    s_killCount.store(0);
    std::thread(workerThread).detach();
    LOGI("[AnogsKiller] Started v3.2");
}

inline void Stop() { s_running.store(false); }
inline bool IsRunning() { return s_running.load(); }
inline int GetKillCount() { return s_killCount.load(); }
inline const std::string& GetLogFilePath() { return s_logFilePath; }

} // namespace AnogsKiller
