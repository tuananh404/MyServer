#pragma once
// EspOverlay.h — EGL hook to render ImGui ESP directly on game's OpenGL context
// v2: mutex guard, try/catch safety, optimized context change handling

#include <EGL/egl.h>
#include <GLES3/gl3.h>
#include <dlfcn.h>
#include <atomic>
#include <mutex>
#include "imgui.h"
#include "imgui_internal.h"
#include "backends/imgui_impl_opengl3.h"
#include "backends/imgui_impl_android.h"
#include "../ImGui/FONTS/DEFAULT.h"
#include "Dobby/dobby.h"
#include "EspVariables.h"
#include "Includes/Logger.h"

static bool                g_EspImGuiInited = false;
static std::atomic<bool>   g_EglHooked{false};
static EGLContext          g_EspGlContext = EGL_NO_CONTEXT;
static std::mutex          g_EspImGuiMutex;  // Guard ImGui init/shutdown/render

// Original eglSwapBuffers
using PFN_eglSwapBuffers = EGLBoolean (*)(EGLDisplay, EGLSurface);
static PFN_eglSwapBuffers orig_eglSwapBuffers = nullptr;

static EGLBoolean hook_eglSwapBuffers(EGLDisplay dpy, EGLSurface surface) {
    std::lock_guard<std::mutex> lock(g_EspImGuiMutex);
    EGLContext currentContext = eglGetCurrentContext();

    if (currentContext == EGL_NO_CONTEXT) {
        return orig_eglSwapBuffers(dpy, surface);
    }

    // Context changed — clean shutdown to avoid crash
    if (g_EspImGuiInited && g_EspGlContext != currentContext) {
        try {
            ImGui_ImplOpenGL3_Shutdown();
            ImGui_ImplAndroid_Shutdown();
            ImGui::DestroyContext();
        } catch(...) {}
        g_EspImGuiInited = false;
        g_EspGlContext = EGL_NO_CONTEXT;
    }

    // Lazy init ImGui on first valid surface
    if (!g_EspImGuiInited) {
        int w = 0, h = 0;
        if (eglQuerySurface(dpy, surface, EGL_WIDTH, &w) == EGL_TRUE &&
            eglQuerySurface(dpy, surface, EGL_HEIGHT, &h) == EGL_TRUE &&
            w > 0 && h > 0) {

            IMGUI_CHECKVERSION();
            ImGui::CreateContext();
            ImGuiIO& io = ImGui::GetIO();
            io.IniFilename = nullptr;
            io.DisplaySize = ImVec2((float)w, (float)h);
            ImGui::StyleColorsDark();
            ImGui::GetStyle().ScaleAllSizes(3.0f);

            ImFontConfig fontCfg;
            fontCfg.SizePixels = 30.0f;
            io.Fonts->AddFontFromMemoryTTF((void*)Custom3, sizeof(Custom3), 30.0f, &fontCfg);

            ImGui_ImplAndroid_Init(nullptr);
            ImGui_ImplOpenGL3_Init("#version 300 es");
            g_EspGlContext = currentContext;
            g_EspImGuiInited = true;
        }
    }

    // Render ESP if ready — wrapped in try/catch to prevent crash propagation
    if (g_EspImGuiInited && g_espReady) {
        try {
            int w = 0, h = 0;
            eglQuerySurface(dpy, surface, EGL_WIDTH, &w);
            eglQuerySurface(dpy, surface, EGL_HEIGHT, &h);
            if (w > 0 && h > 0) {
                // ── SAVE GL state (prevent screen flicker after ImGui modifies GL state) ──
                GLboolean lastBlend       = glIsEnabled(GL_BLEND);
                GLboolean lastDepthTest   = glIsEnabled(GL_DEPTH_TEST);
                GLboolean lastCullFace    = glIsEnabled(GL_CULL_FACE);
                GLboolean lastScissorTest = glIsEnabled(GL_SCISSOR_TEST);
                GLboolean lastStencilTest = glIsEnabled(GL_STENCIL_TEST);
                GLint lastBlendSrc = GL_SRC_ALPHA, lastBlendDst = GL_ONE_MINUS_SRC_ALPHA;
                glGetIntegerv(GL_BLEND_SRC_RGB, &lastBlendSrc);
                glGetIntegerv(GL_BLEND_DST_RGB, &lastBlendDst);
                GLint lastProgram = 0;
                glGetIntegerv(GL_CURRENT_PROGRAM, &lastProgram);

                g_screenW = w; g_screenH = h;
                ImGuiIO& io = ImGui::GetIO();
                io.DisplaySize = ImVec2((float)w, (float)h);

                ImGui_ImplOpenGL3_NewFrame();
                ImGui_ImplAndroid_NewFrame(w, h);
                ImGui::NewFrame();

                // EspBeginDraw runs unified single-pass: aimbot target + ESP + aim line
                EspBeginDraw();

                ImGui::Render();
                ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

                // ── RESTORE GL state ──
                if (lastBlend) glEnable(GL_BLEND); else glDisable(GL_BLEND);
                glBlendFunc(lastBlendSrc, lastBlendDst);
                if (lastDepthTest) glEnable(GL_DEPTH_TEST); else glDisable(GL_DEPTH_TEST);
                if (lastCullFace) glEnable(GL_CULL_FACE); else glDisable(GL_CULL_FACE);
                if (lastScissorTest) glEnable(GL_SCISSOR_TEST); else glDisable(GL_SCISSOR_TEST);
                if (lastStencilTest) glEnable(GL_STENCIL_TEST); else glDisable(GL_STENCIL_TEST);
                if (lastProgram > 0) glUseProgram(lastProgram);
            }
        } catch(...) {
            // Safety: on exception, don't crash the game's render thread
            // ImGui state will be re-initialized on next context change
            LOGE("[EspOverlay] Render exception — skipping frame");
        }
    }

    return orig_eglSwapBuffers(dpy, surface);
}

// ── Install EGL hook called from hack_thread ──
void EspOverlay_Init() {
    if (g_EglHooked.exchange(true)) return;

    void* egl = dlopen("libEGL.so", RTLD_NOW);
    if (!egl) {
        LOGE("[EspOverlay] dlopen libEGL.so failed");
        g_EglHooked = false;
        return;
    }

    void* swap = dlsym(egl, "eglSwapBuffers");
    if (!swap) {
        LOGE("[EspOverlay] dlsym eglSwapBuffers failed");
        dlclose(egl);
        g_EglHooked = false;
        return;
    }

    if (DobbyHook(swap, (dobby_dummy_func_t)hook_eglSwapBuffers,
                  (dobby_dummy_func_t*)&orig_eglSwapBuffers) != 0) {
        LOGE("[EspOverlay] DobbyHook eglSwapBuffers failed");
        dlclose(egl);
        g_EglHooked = false;
        return;
    }

    LOGI("[EspOverlay] eglSwapBuffers hooked OK");
}
