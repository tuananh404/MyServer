#include "CrashLogger.h"

#include <android/log.h>
#include <atomic>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <dlfcn.h>
#include <fcntl.h>
#include <pthread.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

// Keep this file standalone (no dependency on Menu/Utils) to reduce risk.

static JavaVM* g_vm = nullptr;
static std::atomic<bool> g_installed{false};

static void get_process_name(char* out, size_t n) {
    if (!out || n == 0) return;
    out[0] = 0;

    int fd = open("/proc/self/cmdline", O_RDONLY);
    if (fd < 0) {
        strncpy(out, "unknown", n - 1);
        out[n - 1] = 0;
        return;
    }
    ssize_t r = read(fd, out, n - 1);
    close(fd);
    if (r <= 0) {
        strncpy(out, "unknown", n - 1);
        out[n - 1] = 0;
        return;
    }
    out[r] = 0;
    // cmdline is NUL-separated
    for (ssize_t i = 0; i < r; i++) {
        if (out[i] == 0) break;
        if (out[i] == ':') { out[i] = 0; break; }
    }
}

static void mkdirs(const char* path) {
    if (!path || !path[0]) return;
    char tmp[1024];
    strncpy(tmp, path, sizeof(tmp) - 1);
    tmp[sizeof(tmp) - 1] = 0;
    size_t len = strnlen(tmp, sizeof(tmp));
    for (size_t i = 1; i < len; i++) {
        if (tmp[i] == '/') {
            tmp[i] = 0;
            mkdir(tmp, 0775);
            tmp[i] = '/';
        }
    }
    mkdir(tmp, 0775);
}

static void get_log_dir(char* out, size_t n) {
    if (!out || n == 0) return;
    out[0] = 0;
    char pkg[256];
    get_process_name(pkg, sizeof(pkg));
    // Matches Java CrashHandler: Documents/<package>/crash_logs
    snprintf(out, n, "/storage/emulated/0/Documents/%s/crash_logs", pkg);
}

static void get_log_dir_fallback(char* out, size_t n) {
    if (!out || n == 0) return;
    out[0] = 0;
    char pkg[256];
    get_process_name(pkg, sizeof(pkg));
    // App-scoped external storage (should be writable without extra permission).
    snprintf(out, n, "/storage/emulated/0/Android/data/%s/files/crash_logs", pkg);
}

static void format_time(char* out, size_t n) {
    if (!out || n == 0) return;
    std::time_t t = std::time(nullptr);
    std::tm tmv;
    localtime_r(&t, &tmv);
    std::snprintf(out, n, "%04d_%02d_%02d-%02d_%02d_%02d",
                  tmv.tm_year + 1900, tmv.tm_mon + 1, tmv.tm_mday,
                  tmv.tm_hour, tmv.tm_min, tmv.tm_sec);
}

static void write_line(int fd, const char* s) {
    if (fd < 0 || !s) return;
    (void)write(fd, s, (size_t)strlen(s));
}

static void write_hex(int fd, const char* key, uintptr_t v) {
    char buf[128];
    std::snprintf(buf, sizeof(buf), "%s0x%lx\n", key, (unsigned long)v);
    write_line(fd, buf);
}

static void write_pc_info(int fd, const char* label, uintptr_t pc) {
    Dl_info info;
    memset(&info, 0, sizeof(info));
    if (dladdr((void*)pc, &info) && info.dli_fname) {
        uintptr_t base = (uintptr_t)info.dli_fbase;
        uintptr_t off = pc - base;
        char buf[512];
        std::snprintf(buf, sizeof(buf), "%s pc=0x%lx lib=%s base=0x%lx off=0x%lx sym=%s\n",
                      label,
                      (unsigned long)pc,
                      info.dli_fname,
                      (unsigned long)base,
                      (unsigned long)off,
                      info.dli_sname ? info.dli_sname : "(null)");
        write_line(fd, buf);
    } else {
        write_hex(fd, label, pc);
    }
}

static struct sigaction g_old_segv;
static struct sigaction g_old_abrt;

static void crash_handler(int sig, siginfo_t* si, void* uctx) {
    (void)uctx;
    char ts[64];
    format_time(ts, sizeof(ts));

    char dir[512];
    char path[768];
    get_log_dir(dir, sizeof(dir));
    mkdirs(dir);
    std::snprintf(path, sizeof(path), "%s/crash_native_%s.txt", dir, ts);

    int fd = open(path, O_CREAT | O_WRONLY | O_TRUNC, 0644);
    if (fd < 0) {
        // Scoped storage or device policy may block Documents. Fallback to app-scoped external dir.
        get_log_dir_fallback(dir, sizeof(dir));
        mkdirs(dir);
        std::snprintf(path, sizeof(path), "%s/crash_native_%s.txt", dir, ts);
        fd = open(path, O_CREAT | O_WRONLY | O_TRUNC, 0644);
    }
    if (fd >= 0) {
        write_line(fd, "=============== NATIVE CRASH ===============\n");
        char buf[256];
        std::snprintf(buf, sizeof(buf), "signal=%d code=%d addr=%p tid=%d pid=%d\n",
                      sig,
                      si ? si->si_code : 0,
                      si ? si->si_addr : nullptr,
                      (int)gettid(),
                      (int)getpid());
        write_line(fd, buf);

#if defined(__aarch64__)
        // Best-effort: extract PC/LR from ucontext if available.
        // We avoid including platform headers; rely on standard layout used by bionic.
        // If this fails on a device, dladdr below still helps for saved return addresses.
        // NOTE: Keeping minimal to avoid crashing inside handler.
        // We try to read ucontext_t fields via known offsets only if uctx looks valid.
        if (uctx) {
            // aarch64: mcontext.pc and mcontext.regs[30] (lr)
            // This is intentionally conservative: guard reads.
            uintptr_t pc = 0;
            uintptr_t lr = 0;
            // Heuristic offsets: works on bionic ucontext_t for arm64.
            // If incorrect, values remain 0.
            const uint8_t* p = (const uint8_t*)uctx;
            // Try common offset for pc/lr inside mcontext: 0xB0/0xA8 range.
            // We'll probe a small set to reduce risk.
            const size_t pc_offs[] = {0xB0, 0xB8, 0xC0};
            const size_t lr_offs[] = {0xA8, 0xA0, 0x98};
            for (size_t i = 0; i < sizeof(pc_offs)/sizeof(pc_offs[0]) && pc == 0; i++) {
                uintptr_t tmp = 0;
                memcpy(&tmp, p + pc_offs[i], sizeof(tmp));
                if (tmp > 0x10000) pc = tmp;
            }
            for (size_t i = 0; i < sizeof(lr_offs)/sizeof(lr_offs[0]) && lr == 0; i++) {
                uintptr_t tmp = 0;
                memcpy(&tmp, p + lr_offs[i], sizeof(tmp));
                if (tmp > 0x10000) lr = tmp;
            }
            if (pc) write_pc_info(fd, "PC", pc);
            if (lr) write_pc_info(fd, "LR", lr);
        }
#elif defined(__arm__)
        // armv7: best-effort not implemented; still log fault addr.
#endif

        close(fd);
    }

    // Also emit to logcat (may still be helpful).
    __android_log_print(ANDROID_LOG_ERROR, "NativeCrash", "Native crash captured: %s", path);

    // Chain to old handler to let Android generate tombstone if possible.
    struct sigaction* old = nullptr;
    if (sig == SIGSEGV) old = &g_old_segv;
    else if (sig == SIGABRT) old = &g_old_abrt;

    if (old && old->sa_sigaction && (old->sa_flags & SA_SIGINFO)) {
        old->sa_sigaction(sig, si, uctx);
    } else if (old && old->sa_handler && old->sa_handler != SIG_DFL && old->sa_handler != SIG_IGN) {
        old->sa_handler(sig);
    } else {
        signal(sig, SIG_DFL);
        raise(sig);
    }
}

static void install_handlers() {
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_sigaction = crash_handler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK;

    sigaction(SIGSEGV, &sa, &g_old_segv);
    sigaction(SIGABRT, &sa, &g_old_abrt);
}

void CrashLogger_Install(JNIEnv* env) {
    if (g_installed.exchange(true)) return;

    if (env) {
        env->GetJavaVM(&g_vm);
    }
    install_handlers();
}
