// Force NDK compile rebuild cache update 2026-06-01
#include <jni.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>
#include <stdint.h>
#include <stdio.h>
#include <vector>
#include <chrono>
#include <cmath>
#include <sys/stat.h>
#include <string>
#include <thread>
#include <mutex>
#include "ImGui/imgui_internal.h"
#include "ImGui/imgui.h"
#include "ImGui/backends/imgui_impl_android.h"
#include "ImGui/backends/imgui_impl_opengl3.h"
#include <EGL/egl.h>
#include <GLES3/gl3.h>
#include <sys/system_properties.h>
#include "ImGui/Verdana.h"
#include "ImGui/FONTS/fa_solid.h"

// Mod Features Integration
#include "Features/AovHooks.h"
#include "Features/EspVariables.h"
#include "Includes/CrashLogger.h"
#include "Includes/AnogsKiller.h"
#include "Includes/Utils.hpp"
#include "Offsets.h"

// ============================================================
// FONTAWESOME ICON MAPS (UTF-8 Hex)
// ============================================================
#define ICON_FA_USER "\xef\x80\x87"        // f007
#define ICON_FA_EYE "\xef\x81\xae"         // f06e
#define ICON_FA_CROSSHAIRS "\xef\x81\x9b"  // f05b
#define ICON_FA_COGS "\xef\x82\x85"        // f085
#define ICON_FA_SLIDERS_H "\xef\x87\x9e"   // f1de
#define ICON_FA_POWER_OFF "\xef\x80\x91"   // f011
#define ICON_FA_HOME "\xef\x80\x95"        // f015
#define ICON_FA_INFO_CIRCLE "\xef\x81\x9a" // f05a

// ============================================================
// ENUMS & CONFIG
// ============================================================
enum MenuTab {
    TAB_VIP = 0,
    TAB_AIM,
    TAB_AUTO,
    TAB_INFOR
};

MenuTab currentTab = TAB_INFOR; 
bool isMinimized = false;
float uiScale = 1.0f;
static float g_themeHue = 0.0f; // Animated hue cycling

// Helper: HSV to ImVec4
static ImVec4 HsvToColor(float h, float s, float v, float a = 1.0f) {
    float r, g, b;
    ImGui::ColorConvertHSVtoRGB(h, s, v, r, g, b);
    return ImVec4(r, g, b, a);
}

int screenWidth = 0;
int screenHeight = 0;
bool g_Initialized = false;
static EGLContext g_glContext = EGL_NO_CONTEXT;
static std::mutex g_imguiMutex;  // Guard ImGui init/shutdown/render
ImGuiWindow* g_window = NULL;
GLuint g_appIconTexture = 0;
int g_appIconWidth = 0;
int g_appIconHeight = 0;

// ============================================================
// ServerKey Authentication & JNI Helpers
// ============================================================
#define CLIENT_TOKEN "TKN_X8F2K9P1M5L7" // Replace with actual Token Package string from Dashboard

extern JavaVM* g_jvm;

static bool g_isLoggedIn = false;
static char g_keyInput[64] = "";
static std::string g_menuTitle = "wtuananh6868";
static std::string g_loginError = "";
static bool g_autoLoginChecked = false;

JNIEnv* getJNIEnv() {
    if (!g_jvm) return nullptr;
    JNIEnv* env = nullptr;
    jint res = g_jvm->GetEnv((void**)&env, JNI_VERSION_1_6);
    if (res == JNI_EDETACHED) {
        if (g_jvm->AttachCurrentThread(&env, nullptr) != 0) {
            return nullptr;
        }
    }
    return env;
}

struct JavaLoginInterface {
    static jobject getStaticContext(JNIEnv* env) {
        jclass clazz = env->FindClass("com/mycompany/application/MainActivity");
        if (!clazz) return nullptr;
        jfieldID fid = env->GetStaticFieldID(clazz, "sContext", "Landroid/content/Context;");
        if (!fid) return nullptr;
        jobject ctx = env->GetStaticObjectField(clazz, fid);
        env->DeleteLocalRef(clazz);
        return ctx;
    }

    static std::string loadSavedKey(JNIEnv* env) {
        jclass clazz = env->FindClass("com/mycompany/application/MainActivity");
        if (!clazz) return "";
        jmethodID mid = env->GetStaticMethodID(clazz, "loadKey", "(Landroid/content/Context;)Ljava/lang/String;");
        if (!mid) {
            env->DeleteLocalRef(clazz);
            return "";
        }
        jobject ctx = getStaticContext(env);
        if (!ctx) {
            env->DeleteLocalRef(clazz);
            return "";
        }
        jstring jKey = (jstring)env->CallStaticObjectMethod(clazz, mid, ctx);
        env->DeleteLocalRef(ctx);
        if (!jKey) {
            env->DeleteLocalRef(clazz);
            return "";
        }
        const char* str = env->GetStringUTFChars(jKey, nullptr);
        std::string key(str ? str : "");
        if (str) env->ReleaseStringUTFChars(jKey, str);
        env->DeleteLocalRef(jKey);
        env->DeleteLocalRef(clazz);
        return key;
    }

    static void startLogin(JNIEnv* env, const std::string& token, const std::string& key) {
        jclass clazz = env->FindClass("com/mycompany/application/MainActivity");
        if (!clazz) return;
        jmethodID mid = env->GetStaticMethodID(clazz, "startLoginThread", "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V");
        if (!mid) {
            env->DeleteLocalRef(clazz);
            return;
        }
        jobject ctx = getStaticContext(env);
        if (!ctx) {
            env->DeleteLocalRef(clazz);
            return;
        }
        jstring jToken = env->NewStringUTF(token.c_str());
        jstring jKey = env->NewStringUTF(key.c_str());
        env->CallStaticVoidMethod(clazz, mid, ctx, jToken, jKey);
        env->DeleteLocalRef(jToken);
        env->DeleteLocalRef(jKey);
        env->DeleteLocalRef(ctx);
        env->DeleteLocalRef(clazz);
    }

    static int getLoginStatus(JNIEnv* env) {
        jclass clazz = env->FindClass("com/mycompany/application/MainActivity");
        if (!clazz) return 0;
        jfieldID fid = env->GetStaticFieldID(clazz, "sLoginStatus", "I");
        if (!fid) {
            env->DeleteLocalRef(clazz);
            return 0;
        }
        int status = env->GetStaticIntField(clazz, fid);
        env->DeleteLocalRef(clazz);
        return status;
    }

    static std::string getErrorMessage(JNIEnv* env) {
        return getStaticStringField(env, "sErrorMessage");
    }

    static std::string getTokenName(JNIEnv* env) {
        return getStaticStringField(env, "sTokenName");
    }

    static std::string getDisplayText(JNIEnv* env) {
        return getStaticStringField(env, "sDisplayText");
    }

private:
    static std::string getStaticStringField(JNIEnv* env, const char* fieldName) {
        jclass clazz = env->FindClass("com/mycompany/application/MainActivity");
        if (!clazz) return "";
        jfieldID fid = env->GetStaticFieldID(clazz, fieldName, "Ljava/lang/String;");
        if (!fid) {
            env->DeleteLocalRef(clazz);
            return "";
        }
        jstring jStr = (jstring)env->GetStaticObjectField(clazz, fid);
        if (!jStr) {
            env->DeleteLocalRef(clazz);
            return "";
        }
        const char* str = env->GetStringUTFChars(jStr, nullptr);
        std::string res(str ? str : "");
        if (str) env->ReleaseStringUTFChars(jStr, str);
        env->DeleteLocalRef(jStr);
        env->DeleteLocalRef(clazz);
        return res;
    }
};

// ============================================================
// JNI BINDINGS DECLARATION
// ============================================================
extern "C" {
    JNIEXPORT void JNICALL Java_com_mycompany_application_GLES3JNIView_init(JNIEnv* env, jclass cls);
    JNIEXPORT void JNICALL Java_com_mycompany_application_GLES3JNIView_resize(JNIEnv* env, jobject obj, jint width, jint height);
    JNIEXPORT void JNICALL Java_com_mycompany_application_GLES3JNIView_step(JNIEnv* env, jobject obj);
    JNIEXPORT void JNICALL Java_com_mycompany_application_GLES3JNIView_imgui_Shutdown(JNIEnv* env, jobject obj);
    JNIEXPORT void JNICALL Java_com_mycompany_application_GLES3JNIView_MotionEventClick(JNIEnv* env, jobject obj, jboolean down, jfloat PosX, jfloat PosY);
    JNIEXPORT jstring JNICALL Java_com_mycompany_application_GLES3JNIView_getWindowRect(JNIEnv *env, jobject thiz);
};

// ============================================================
// THEME & STYLES (NEON CYBERPUNK — Animated Gradient)
// ============================================================
void ApplyWtuananhTheme() {
    ImGuiStyle& s = ImGui::GetStyle();
    
    // Animate hue: slow cycle through cyan → magenta → purple → cyan
    float t = (float)ImGui::GetTime();
    g_themeHue = fmodf(t * 0.05f, 1.0f); // Full cycle ~20s
    
    s.WindowRounding    = 18.0f * uiScale;
    s.ChildRounding     = 14.0f * uiScale;
    s.FrameRounding     = 10.0f * uiScale;
    s.ScrollbarRounding = 10.0f * uiScale;
    s.GrabRounding      = 10.0f * uiScale;

    s.WindowPadding     = ImVec2(0, 0); 
    s.FramePadding      = ImVec2(12.0f * uiScale, 10.0f * uiScale);
    s.ItemSpacing       = ImVec2(12.0f * uiScale, 12.0f * uiScale);
    s.ItemInnerSpacing  = ImVec2(10.0f * uiScale, 8.0f * uiScale);
    s.WindowBorderSize  = 1.5f * uiScale;
    s.ChildBorderSize   = 0.0f;
    
    s.ScrollbarSize     = 26.0f * uiScale;
    s.GrabMinSize       = 32.0f * uiScale;

    // Neon Cyberpunk Colors — animated accent
    const ImVec4 bgMain       = ImVec4(0.03f, 0.03f, 0.06f, 1.0f);       // Deep Blue-Black
    const ImVec4 accent       = HsvToColor(g_themeHue, 0.85f, 1.0f);     // Animated Neon
    const ImVec4 accentDim    = HsvToColor(g_themeHue, 0.70f, 0.40f);    // Dim Accent
    const ImVec4 accent2      = HsvToColor(fmodf(g_themeHue + 0.33f, 1.0f), 0.80f, 0.90f); // Complementary
    const ImVec4 textMain     = ImVec4(0.95f, 0.97f, 1.00f, 1.0f);       // Cool White
    const ImVec4 textSub      = ImVec4(0.50f, 0.55f, 0.65f, 1.0f);       // Blue-Grey
    const ImVec4 transparent  = ImVec4(0,0,0,0);

    s.Colors[ImGuiCol_Text]                 = textMain;
    s.Colors[ImGuiCol_TextDisabled]         = textSub;
    s.Colors[ImGuiCol_WindowBg]             = bgMain;
    s.Colors[ImGuiCol_ChildBg]              = transparent;
    s.Colors[ImGuiCol_Border]               = HsvToColor(g_themeHue, 0.60f, 0.80f, 0.40f);
    s.Colors[ImGuiCol_BorderShadow]         = transparent;
    
    // Sliders & Controls
    s.Colors[ImGuiCol_FrameBg]              = ImVec4(0.08f, 0.08f, 0.14f, 1.0f);
    s.Colors[ImGuiCol_FrameBgHovered]       = ImVec4(0.12f, 0.12f, 0.20f, 1.0f);
    s.Colors[ImGuiCol_FrameBgActive]        = accentDim;
    s.Colors[ImGuiCol_SliderGrab]           = accent;
    s.Colors[ImGuiCol_SliderGrabActive]     = accent2;
    
    // Buttons
    s.Colors[ImGuiCol_Button]               = ImVec4(0.08f, 0.08f, 0.14f, 1.0f);
    s.Colors[ImGuiCol_ButtonHovered]        = ImVec4(0.14f, 0.14f, 0.22f, 1.0f);
    s.Colors[ImGuiCol_ButtonActive]         = accent;
    
    // Separator & Scrollbar
    s.Colors[ImGuiCol_Separator]            = ImVec4(0.15f, 0.15f, 0.25f, 1.0f);
    s.Colors[ImGuiCol_ScrollbarBg]          = ImVec4(0.04f, 0.04f, 0.08f, 0.60f);
    s.Colors[ImGuiCol_ScrollbarGrab]        = HsvToColor(g_themeHue, 0.70f, 0.80f, 0.75f);
    s.Colors[ImGuiCol_ScrollbarGrabHovered] = HsvToColor(g_themeHue, 0.75f, 0.90f, 0.90f);
    s.Colors[ImGuiCol_ScrollbarGrabActive]  = accent;
}

// ============================================================
// UI COMPONENTS
// ============================================================

void SectionTitle(const char* label) {
    ImGui::Spacing();
    ImGui::PushStyleColor(ImGuiCol_Text, HsvToColor(g_themeHue, 0.85f, 1.0f)); // Animated Neon Accent
    ImGui::SetWindowFontScale(uiScale * 1.05f);
    ImGui::TextUnformatted(label);
    ImGui::SetWindowFontScale(uiScale);
    ImGui::PopStyleColor();
    ImGui::Spacing();
}

// Enlarged Toggle Card
bool ToggleCard(const char* label, bool* value) {
    ImGuiWindow* window = ImGui::GetCurrentWindow();
    if (window->SkipItems) return false;

    ImDrawList* dl = window->DrawList;
    ImVec2 p = ImGui::GetCursorScreenPos();
    float w = ImGui::GetContentRegionAvail().x * 0.70f;
    float h = 50.0f * uiScale; 


    ImGui::InvisibleButton(label, ImVec2(w, h));
    bool clicked = ImGui::IsItemClicked();
    if (clicked) *value = !(*value);
    bool hovered = ImGui::IsItemHovered();

    // Dark blue-tinted transparent background
    ImVec4 bgColVec = ImVec4(0.06f, 0.06f, 0.12f, 0.60f); 
    ImU32 bgCol = ImGui::ColorConvertFloat4ToU32(bgColVec);
    
    // Background Card
    dl->AddRectFilled(p, ImVec2(p.x + w, p.y + h), bgCol, 12.0f * uiScale);
    
    // Animated neon border
    ImVec4 borderColVec = *value ? HsvToColor(g_themeHue, 0.85f, 1.0f, 0.80f) : (hovered ? HsvToColor(g_themeHue, 0.60f, 0.80f, 0.40f) : HsvToColor(g_themeHue, 0.40f, 0.50f, 0.20f));
    dl->AddRect(p, ImVec2(p.x + w, p.y + h), ImGui::ColorConvertFloat4ToU32(borderColVec), 12.0f * uiScale, 0, 1.5f);

    // Enlarged Toggle Track
    float tw = 50.0f * uiScale, th = 26.0f * uiScale, tr = 13.0f * uiScale;
    ImVec2 trackP = ImVec2(p.x + w - tw - 16.0f * uiScale, p.y + (h - th) * 0.5f);
    
    ImU32 trackCol = *value ? ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f)) : ImGui::ColorConvertFloat4ToU32(ImVec4(0.20f, 0.20f, 0.30f, 1.0f));
    dl->AddRectFilled(trackP, ImVec2(trackP.x + tw, trackP.y + th), trackCol, th * 0.5f);

    // Enlarged Knob
    float thumbX = trackP.x + tr + (*value ? (tw - tr * 2.0f) : 0.0f);
    ImU32 knobCol = *value ? IM_COL32(255, 255, 255, 255) : IM_COL32(140, 140, 140, 255);
    dl->AddCircleFilled(ImVec2(thumbX, trackP.y + tr), tr - 2.5f * uiScale, knobCol);

    float maxTextWidth = w - tw - 50.0f * uiScale; // More padding to avoid edge clipping
    ImVec2 ts = ImGui::CalcTextSize(label);
    float labelScale = 1.0f;
    if (ts.x > maxTextWidth) {
        labelScale = maxTextWidth / ts.x;
        if (labelScale < 0.40f) labelScale = 0.40f; // Allow more aggressive scaling
    }

    if (labelScale < 1.0f) ImGui::SetWindowFontScale(uiScale * labelScale);
    ts = ImGui::CalcTextSize(label);

    ImU32 textCol = *value ? IM_COL32(245, 245, 245, 255) : IM_COL32(170, 170, 170, 255);
    dl->AddText(ImVec2(p.x + 16.0f * uiScale, p.y + (h - ts.y) * 0.5f), textCol, label);

    if (labelScale < 1.0f) ImGui::SetWindowFontScale(uiScale);

    return clicked;
}

bool SidebarItem(const char* label, const char* iconChar, bool active) {
    ImGuiWindow* window = ImGui::GetCurrentWindow();
    if (window->SkipItems) return false;
    
    ImDrawList* dl = window->DrawList;
    // Align centered inside the 270px sidebar
    ImGui::SetCursorPosX(5.0f * uiScale);
    ImVec2 p = ImGui::GetCursorScreenPos();
    float w = 260.0f * uiScale; 
    float h = 40.0f * uiScale;  
    ImVec2 btnPos = p;

    ImGui::InvisibleButton(label, ImVec2(w, h));
    bool clicked = ImGui::IsItemClicked();
    bool hovered = ImGui::IsItemHovered();

    if (active) {
        // Neon Gradient Glow Box
        ImU32 colLeft = ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.70f, 0.30f, 1.0f));
        ImU32 colRight = ImGui::ColorConvertFloat4ToU32(ImVec4(0.03f, 0.03f, 0.06f, 0.0f));
        dl->AddRectFilledMultiColor(p, ImVec2(p.x + w, p.y + h), colLeft, colRight, colRight, colLeft);
        
        // Glowing neon border
        dl->AddRect(p, ImVec2(p.x + w, p.y + h), ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f, 0.90f)), 8.0f * uiScale, 0, 1.5f * uiScale);
        
        // Left-side accent strip — animated color
        dl->AddRectFilled(p, ImVec2(p.x + 5.0f * uiScale, p.y + h), ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f)), 8.0f * uiScale, ImDrawFlags_RoundCornersLeft);
    } else if (hovered) {
        dl->AddRectFilled(p, ImVec2(p.x + w, p.y + h), ImGui::ColorConvertFloat4ToU32(ImVec4(0.10f, 0.10f, 0.18f, 0.60f)), 8.0f * uiScale);
    }

    // Scale up slightly if active, but keep text smaller
    float fontScale = active ? 0.95f : 0.85f;
    
    ImU32 iconCol = active ? ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f)) : IM_COL32(120, 130, 160, 255);
    float cx = p.x + 30.0f * uiScale;
    float cy = p.y + h * 0.5f;
    
    ImGui::SetWindowFontScale(uiScale * fontScale);
    ImVec2 its = ImGui::CalcTextSize(iconChar);
    dl->AddText(ImVec2(cx - its.x * 0.5f, cy - its.y * 0.5f), iconCol, iconChar);

    float labelFontScale = active ? 0.85f : 0.75f;
    float maxTextWidth = w - 65.0f * uiScale; // Room after icon
    
    ImGui::SetWindowFontScale(uiScale * labelFontScale);
    ImVec2 ts = ImGui::CalcTextSize(label);
    
    if (ts.x > maxTextWidth) {
        float scaleAdjust = maxTextWidth / ts.x;
        if (scaleAdjust < 1.0f) {
            labelFontScale *= scaleAdjust;
            if (labelFontScale < 0.55f) labelFontScale = 0.55f;
            ImGui::SetWindowFontScale(uiScale * labelFontScale);
            ts = ImGui::CalcTextSize(label);
        }
    }
    
    ImU32 txtCol = active ? IM_COL32(255, 255, 255, 255) : IM_COL32(160, 160, 160, 255);
    dl->AddText(ImVec2(p.x + 55.0f * uiScale, p.y + (h - ts.y) * 0.5f), txtCol, label);
    
    ImGui::SetWindowFontScale(uiScale); // Reset

    return clicked;
}

// Enlarged Thin Slider Component
bool ThinRedSlider(const char* label, float* value, float minVal, float maxVal, const char* format) {
    ImGuiWindow* window = ImGui::GetCurrentWindow();
    if (window->SkipItems) return false;

    ImDrawList* dl = window->DrawList;
    ImVec2 p = ImGui::GetCursorScreenPos();
    float w = ImGui::GetContentRegionAvail().x;
    float totalH = 75.0f * uiScale; // Taller

    ImGui::InvisibleButton(label, ImVec2(w, totalH));
    bool active = ImGui::IsItemActive();
    bool hovered = ImGui::IsItemHovered();

    char valText[64];
    sprintf(valText, format, *value);
    
    ImGui::SetWindowFontScale(uiScale * 0.95f);
    ImVec2 lblSize = ImGui::CalcTextSize(label);
    ImVec2 valSize = ImGui::CalcTextSize(valText);
    ImGui::SetWindowFontScale(uiScale);

    dl->AddText(ImVec2(p.x, p.y), IM_COL32(200, 200, 200, 255), label);
    // Add right padding so text is not hidden in the edge
    dl->AddText(ImVec2(p.x + w - valSize.x - 25.0f * uiScale, p.y), ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f)), valText);

    // Enlarged Track & Knob
    float knobR = 12.0f * uiScale;
    float barH = 8.0f * uiScale;
    float sliderBarY = p.y + lblSize.y + 15.0f * uiScale;
    
    ImVec2 barStart = ImVec2(p.x + knobR, sliderBarY);
    ImVec2 barEnd = ImVec2(p.x + w - knobR, sliderBarY);
    float barW = barEnd.x - barStart.x;

    if (active && barW > 0.0f) {
        float mouseX = ImGui::GetIO().MousePos.x;
        float clickedFraction = (mouseX - barStart.x) / barW;
        if (clickedFraction < 0.0f) clickedFraction = 0.0f;
        if (clickedFraction > 1.0f) clickedFraction = 1.0f;
        *value = minVal + clickedFraction * (maxVal - minVal);
    }

    ImU32 trackCol = ImGui::ColorConvertFloat4ToU32(ImVec4(0.20f, 0.20f, 0.20f, 1.0f));
    dl->AddRectFilled(ImVec2(barStart.x, barStart.y - barH*0.5f), ImVec2(barEnd.x, barEnd.y + barH*0.5f), trackCol, barH * 0.5f);

    float fillFraction = (*value - minVal) / (maxVal - minVal);
    if (fillFraction < 0.0f) fillFraction = 0.0f;
    if (fillFraction > 1.0f) fillFraction = 1.0f;

    float fillEndX = barStart.x + fillFraction * barW;
    if (fillFraction > 0.0f) {
        // Gradient fill: accent → complementary
        ImU32 fillLeft = ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f));
        ImU32 fillRight = ImGui::ColorConvertFloat4ToU32(HsvToColor(fmodf(g_themeHue + 0.25f, 1.0f), 0.85f, 1.0f));
        dl->AddRectFilledMultiColor(ImVec2(barStart.x, barStart.y - barH*0.5f), ImVec2(fillEndX, barStart.y + barH*0.5f), fillLeft, fillRight, fillRight, fillLeft);
    }

    ImVec2 knobPos = ImVec2(fillEndX, barStart.y);
    ImU32 knobCol = IM_COL32(255, 255, 255, 255);
    ImU32 knobBorderCol = ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f));

    if (active || hovered) {
        dl->AddCircleFilled(knobPos, knobR + 6.0f * uiScale, ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f, 0.25f)));
    }
    dl->AddCircleFilled(knobPos, knobR, knobCol);
    dl->AddCircle(knobPos, knobR, knobBorderCol, 24, 2.0f * uiScale);

    return active;
}

// ============================================================
// HEADER & FOOTER
// ============================================================
void DrawHeader(ImDrawList* dl, ImVec2 pos, ImVec2 size) {
    float headerH = 75.0f * uiScale;
    
    // Avatar Square / App Icon
    float avSz = 54.0f * uiScale;
    ImVec2 avPos = ImVec2(pos.x + 25.0f * uiScale, pos.y + (headerH - avSz) * 0.5f);
    if (g_appIconTexture != 0) {
        dl->AddImageRounded((ImTextureID)(intptr_t)g_appIconTexture, avPos, ImVec2(avPos.x + avSz, avPos.y + avSz), ImVec2(0, 0), ImVec2(1, 1), IM_COL32_WHITE, 12.0f * uiScale);
    } else {
        // Avatar with gradient fill
        ImU32 avCol1 = ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f));
        ImU32 avCol2 = ImGui::ColorConvertFloat4ToU32(HsvToColor(fmodf(g_themeHue + 0.30f, 1.0f), 0.85f, 0.90f));
        dl->AddRectFilledMultiColor(avPos, ImVec2(avPos.x + avSz, avPos.y + avSz), avCol1, avCol2, avCol2, avCol1);
        
        // 'W' inside Avatar
        ImGui::SetWindowFontScale(1.4f * uiScale);
        ImVec2 ats = ImGui::CalcTextSize("W");
        dl->AddText(ImVec2(avPos.x + (avSz - ats.x)*0.5f, avPos.y + (avSz - ats.y)*0.5f), IM_COL32(255,255,255,255), "W");
        ImGui::SetWindowFontScale(uiScale);
    }

    // Title
    float textX = avPos.x + avSz + 18.0f * uiScale;
    ImGui::SetWindowFontScale(1.25f * uiScale);
    dl->AddText(ImVec2(textX, pos.y + 10.0f * uiScale), IM_COL32(245,245,245,255), g_menuTitle.c_str());
    
    // Subtitle
    ImGui::SetWindowFontScale(0.95f * uiScale);
    dl->AddText(ImVec2(textX, pos.y + 38.0f * uiScale), ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.40f, 0.70f)), "Arena Of Valor");
    ImGui::SetWindowFontScale(uiScale);

    // Power Off Button (Minimize) using InvisibleButton & DrawList
    float rightPad = 40.0f * uiScale;
    float btnSz = 54.0f * uiScale;
    ImVec2 btnPos = ImVec2(pos.x + size.x - rightPad - btnSz, pos.y + (headerH - btnSz) * 0.5f);
    
    ImGui::SetCursorScreenPos(btnPos);
    ImGui::InvisibleButton("##PowerBtn", ImVec2(btnSz, btnSz));
    bool isHovered = ImGui::IsItemHovered();
    bool isActive = ImGui::IsItemActive();
    if (ImGui::IsItemClicked()) isMinimized = true;
    
    ImU32 btnCol = isActive ? ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f, 0.9f)) :
                   isHovered ? ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f, 0.7f)) :
                   ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f, 1.0f));
                   
    ImGui::SetWindowFontScale(uiScale * (35.0f / 32.0f)); // Icon size ~34-36px
    ImVec2 its = ImGui::CalcTextSize(ICON_FA_POWER_OFF);
    dl->AddText(ImVec2(btnPos.x + (btnSz - its.x)*0.5f, btnPos.y + (btnSz - its.y)*0.5f), btnCol, ICON_FA_POWER_OFF);
    ImGui::SetWindowFontScale(uiScale);

    // Separator line
    dl->AddLine(ImVec2(pos.x, pos.y + headerH), ImVec2(pos.x + size.x, pos.y + headerH), ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.50f, 0.30f)), 1.5f * uiScale);
}

void DrawFooter(ImDrawList* dl, ImVec2 pos, ImVec2 size) {
    float footerH = 45.0f * uiScale;
    float footY = pos.y + size.y - footerH;

    dl->AddLine(ImVec2(pos.x, footY), ImVec2(pos.x + size.x, footY), ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.50f, 0.30f)), 1.5f * uiScale);
    
    // Background Panel
    dl->AddRectFilled(ImVec2(pos.x, footY + 1), ImVec2(pos.x + size.x, footY + footerH), ImGui::ColorConvertFloat4ToU32(ImVec4(0.03f, 0.03f, 0.06f, 1.0f)), 18.0f * uiScale, ImDrawFlags_RoundCornersBottom);

    float cy = footY + footerH * 0.5f;
    float sx = pos.x + 25.0f * uiScale;

    // Green dot
    dl->AddCircleFilled(ImVec2(sx, cy), 5.0f * uiScale, ImGui::ColorConvertFloat4ToU32(ImVec4(0.12f, 0.90f, 0.42f, 1.0f)));
    ImVec2 ets = ImGui::CalcTextSize("Internal");
    dl->AddText(ImVec2(sx + 14.0f * uiScale, cy - ets.y*0.5f), IM_COL32(180, 190, 200, 255), "Internal");

    sx += 140.0f * uiScale;
    dl->AddCircleFilled(ImVec2(sx, cy), 5.0f * uiScale, ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f)));
    ImVec2 bts = ImGui::CalcTextSize("BYPASS ACTIVE");
    dl->AddText(ImVec2(sx + 14.0f * uiScale, cy - bts.y*0.5f), ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f)), "BYPASS ACTIVE");
}

// ============================================================
// TABS CONTENT
// ============================================================
// ============================================================
// TABS CONTENT
// ============================================================
void DrawVipTab() {
    SectionTitle("V I P   C O R E");
    
    ToggleCard("Map Hack", &HackMap);
    ImGui::Spacing();
    
    if (ToggleCard("Unlock Skin", &UnlockSkin)) {
        AovHooks_SetUnlockSkin(UnlockSkin);
    }
    ImGui::Spacing();
    
    ToggleCard("Unlock 120 FPS", &UnlockFps);
    ImGui::Spacing();
    
    static bool sw_cooldown = false;
    if (ToggleCard("Show Cooldown", &sw_cooldown)) {
        AovHooks_SetShowCooldown(sw_cooldown);
    }
    ImGui::Spacing();
    
    ToggleCard("Check Report", &CheckReport);
    ImGui::Spacing();
    
    static float rawZoom = 0.0f;
    if (ThinRedSlider("Camera Zoom", &rawZoom, 0.0f, 100.0f, "%.0f%%")) {
        CameraZoom = (rawZoom * rawZoom) / 100.0f;
        AovHooks_InitCameraZoom(CameraZoom);
    }
}

void DrawAimbotTab() {
    SectionTitle("A I M B O T   V I P");
    
    ToggleCard("Enable Aim Assist", &g_aimEnabled);
    ImGui::Spacing();
    
    ToggleCard("Draw Aim Line", &g_drawAimLine);
    ImGui::Spacing();
    
    ToggleCard("Aim Skill 1", &g_aimSkill1);
    ImGui::Spacing();
    
    ToggleCard("Aim Skill 2", &g_aimSkill2);
    ImGui::Spacing();
    
    ToggleCard("Aim Skill 3", &g_aimSkill3);
    ImGui::Spacing();
    
    ThinRedSlider("Aim Range", &g_aimDistance, 0.0f, 150.0f, "%.0f");
    ImGui::Spacing();
    
    ThinRedSlider("Aim Smoothness", &g_aimSmooth, 0.0f, 50.0f, "%.1f");
    ImGui::Spacing();
    
    ImGui::Text("Target Priority");
    const char* aimTypes[] = { "Lowest HP %", "Lowest HP", "Closest", "Closest To Aim" };
    if (ImGui::BeginCombo("##TargetPriority", aimTypes[g_aimType])) {
        for (int i = 0; i < 4; i++) {
            bool isSelected = (g_aimType == i);
            if (ImGui::Selectable(aimTypes[i], isSelected)) {
                g_aimType = i;
            }
            if (isSelected) ImGui::SetItemDefaultFocus();
        }
        ImGui::EndCombo();
    }
    ImGui::Spacing();
    
    ImGui::Text("Hero Preset");
    const char* heroPresets[] = { "Custom", "Elsu", "Gildur", "Grakk", "Slimz", "Yue", "Natalya", "Enzo", "Stuart", "Florentino", "Volkath", "Raz" };
    static int selectedPreset = 0;
    if (ImGui::BeginCombo("##HeroPreset", heroPresets[selectedPreset])) {
        for (int i = 0; i < 12; i++) {
            bool isSelected = (selectedPreset == i);
            if (ImGui::Selectable(heroPresets[i], isSelected)) {
                selectedPreset = i;
                g_heroSet = i;
                ApplyHeroConfig();
            }
            if (isSelected) ImGui::SetItemDefaultFocus();
        }
        ImGui::EndCombo();
    }
}

void DrawAutoTab() {
    SectionTitle("A U T O   C O M B O");
    
    ToggleCard("Auto Heal", &g_autoPhuTro);
    ImGui::Spacing();
    
    ThinRedSlider("Heal HP Threshold", &g_myHPThreshold, 0.0f, 100.0f, "%.0f%%");
    ImGui::Spacing();
    
    ToggleCard("Auto Execute", &g_autoBocPha);
    ImGui::Spacing();
    
    ThinRedSlider("Enemy HP Threshold", &g_enemyHPThreshold, 0.0f, 50.0f, "%.0f%%");
    ImGui::Spacing();
    
    ToggleCard("Auto Punish", &g_autoTrungTri);
    ImGui::Spacing();
    
    if (g_autoTrungTri) {
        ToggleCard("Buff Targets", &g_ttBua);
        ImGui::Spacing();
        ToggleCard("Boss Targets", &g_ttBosst);
        ImGui::Spacing();
        ToggleCard("All Targets", &g_ttAll);
        ImGui::Spacing();
    }
}

void DrawInforTab() {
    SectionTitle("D E V E L O P E R   I N F O R M A T I O N");
    
    ImGui::Spacing(); ImGui::Spacing();
    
    ImGui::PushTextWrapPos(ImGui::GetCursorPos().x + ImGui::GetContentRegionAvail().x - 10.0f * uiScale);
    
    ImGui::SetWindowFontScale(1.1f * uiScale);
    ImGui::TextColored(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "Developer: wtuananh6868");
    
    ImGui::Dummy(ImVec2(0, 16.0f * uiScale)); // Spacing ~42-48px
    
    ImGui::SetWindowFontScale(0.95f * uiScale);
    ImGui::TextColored(HsvToColor(g_themeHue, 0.85f, 1.0f), "Telegram: @wtuananh6868");
    
    ImGui::Dummy(ImVec2(0, 20.0f * uiScale));
    
    ImVec2 p = ImGui::GetCursorScreenPos();
    float w = ImGui::GetContentRegionAvail().x;
    ImGui::GetWindowDrawList()->AddLine(p, ImVec2(p.x + w, p.y), ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.40f, 0.25f)), 1.5f * uiScale);
    
    ImGui::Dummy(ImVec2(0, 16.0f * uiScale));
    
    ImGui::SetWindowFontScale(0.90f * uiScale);
    
    static std::string deviceInfo = "";
    if (deviceInfo.empty()) {
        char osVersion[128] = "Unknown";
        char deviceModel[128] = "Unknown";
        
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
        __system_property_get("ro.build.version.release", osVersion);
        __system_property_get("ro.product.model", deviceModel);
#pragma GCC diagnostic pop
        
        int ramGB = 0;
        FILE* fp = fopen("/proc/meminfo", "r");
        if (fp) {
            char line[256];
            while (fgets(line, sizeof(line), fp)) {
                if (strncmp(line, "MemTotal:", 9) == 0) {
                    long long memKb = 0;
                    sscanf(line, "MemTotal: %lld kB", &memKb);
                    ramGB = (int)((float)memKb / (1024.0f * 1024.0f) + 0.5f);
                    break;
                }
            }
            fclose(fp);
        }
        
        char buffer[256];
        snprintf(buffer, sizeof(buffer), "Device: %s | Android %s | RAM: %dGB", deviceModel, osVersion, ramGB);
        deviceInfo = buffer;
    }
    
    ImGui::TextColored(ImVec4(0.7f, 0.7f, 0.7f, 1.0f), "%s", deviceInfo.c_str());
    
    ImGui::PopTextWrapPos();
    ImGui::SetWindowFontScale(uiScale);
}

// ============================================================
// MAIN RENDERING BLOCK
// ============================================================
void DrawMainMenu() {
    // 1. Adjusted layout: decrease width (70%) and increase height (85%) as requested
    float targetW = 750.0f;
    float targetH = 650.0f;
    
    if (screenWidth > 0 && screenHeight > 0) {
        targetW = (float)screenWidth * 0.70f;
        targetH = (float)screenHeight * 0.85f;
        uiScale = targetH / 650.0f;
        
        if (uiScale < 0.8f) uiScale = 0.8f;
        if (uiScale > 2.5f) uiScale = 2.5f;
    }
    
    ApplyWtuananhTheme();

    JNIEnv* env = getJNIEnv();
    if (env) {
        // Auto-login check at start
        if (!g_autoLoginChecked) {
            g_autoLoginChecked = true;
            std::string savedKey = JavaLoginInterface::loadSavedKey(env);
            if (!savedKey.empty()) {
                strncpy(g_keyInput, savedKey.c_str(), sizeof(g_keyInput) - 1);
                JavaLoginInterface::startLogin(env, CLIENT_TOKEN, savedKey);
            }
        }

        // Poll login status from Java
        int status = JavaLoginInterface::getLoginStatus(env);
        if (status == 2) { // Success
            g_isLoggedIn = true;
            std::string tokenName = JavaLoginInterface::getTokenName(env);
            if (!tokenName.empty()) {
                g_menuTitle = tokenName;
            }
        } else if (status == 3) { // Failed
            g_isLoggedIn = false;
            g_loginError = JavaLoginInterface::getErrorMessage(env);
        }

        if (!g_isLoggedIn) {
            // Draw Login screen
            float loginW = 650.0f;
            float loginH = 340.0f;
            if (screenWidth > 0 && screenHeight > 0) {
                loginW = (float)screenWidth * 0.60f;
                loginH = (float)screenHeight * 0.50f;
                if (loginW < 450.0f) loginW = 450.0f;
                if (loginH < 300.0f) loginH = 300.0f;
                uiScale = loginH / 340.0f;
                if (uiScale < 0.8f) uiScale = 0.8f;
                if (uiScale > 2.0f) uiScale = 2.0f;
            }

            ImGui::SetNextWindowSize(ImVec2(loginW, loginH), ImGuiCond_Always);
            if (screenWidth > 0 && screenHeight > 0) {
                ImGui::SetNextWindowPos(ImVec2((screenWidth - loginW) * 0.5f, (screenHeight - loginH) * 0.5f), ImGuiCond_Always);
            }

            ImGuiWindowFlags loginFlags = ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoSavedSettings;
            ImGui::Begin("##LoginWindow", NULL, loginFlags);
            ImGui::SetWindowFontScale(uiScale);

            ImDrawList* dl = ImGui::GetWindowDrawList();
            ImVec2 p = ImGui::GetWindowPos();
            ImVec2 sz = ImGui::GetWindowSize();

            // Background panel (cyberpunk style)
            dl->AddRectFilled(p, ImVec2(p.x + sz.x, p.y + sz.y), ImGui::ColorConvertFloat4ToU32(ImVec4(0.04f, 0.04f, 0.08f, 0.95f)), 14.0f * uiScale);

            std::string dispText = JavaLoginInterface::getDisplayText(env);
            if (dispText.empty()) dispText = "ServerKey by #wtuananh6868";

            ImGui::SetCursorPosY(30.0f * uiScale);
            ImGui::SetWindowFontScale(1.3f * uiScale);
            float textWidth = ImGui::CalcTextSize(dispText.c_str()).x;
            ImGui::SetCursorPosX((sz.x - textWidth) * 0.5f);
            ImGui::TextColored(ImVec4(0.50f, 0.60f, 1.00f, 1.00f), "%s", dispText.c_str());
            ImGui::SetWindowFontScale(uiScale);

            ImGui::Dummy(ImVec2(0, 15.0f * uiScale));
            ImGui::Separator();
            ImGui::Dummy(ImVec2(0, 15.0f * uiScale));

            ImGui::SetCursorPosX(30.0f * uiScale);
            ImGui::Text("Nhập License Key của bạn:");
            
            ImGui::SetCursorPosX(30.0f * uiScale);
            ImGui::PushItemWidth(loginW - 60.0f * uiScale);
            ImGui::InputText("##KeyField", g_keyInput, sizeof(g_keyInput));
            ImGui::PopItemWidth();

            if (!g_loginError.empty()) {
                ImGui::Dummy(ImVec2(0, 5.0f * uiScale));
                ImGui::SetCursorPosX(30.0f * uiScale);
                ImGui::TextColored(ImVec4(1.0f, 0.3f, 0.3f, 1.0f), "Lỗi: %s", g_loginError.c_str());
            }

            ImGui::Dummy(ImVec2(0, 20.0f * uiScale));

            ImGui::SetCursorPosX(loginW * 0.5f - 75.0f * uiScale);
            if (status == 1) { // Logging In
                ImGui::Button("Đang kết nối...", ImVec2(150.0f * uiScale, 40.0f * uiScale));
            } else {
                if (ImGui::Button("ĐĂNG NHẬP", ImVec2(150.0f * uiScale, 40.0f * uiScale))) {
                    g_loginError = "";
                    if (strlen(g_keyInput) > 0) {
                        JavaLoginInterface::startLogin(env, CLIENT_TOKEN, g_keyInput);
                    } else {
                        g_loginError = "Vui lòng nhập Key!";
                    }
                }
            }

            ImGui::End();
            return;
        }
    }

    if (isMinimized) {
        float bubbleSz = 90.0f * uiScale;
        ImGui::SetNextWindowSize(ImVec2(bubbleSz, bubbleSz), ImGuiCond_Always);
        
        if (screenWidth > 0 && screenHeight > 0) {
            ImGui::SetNextWindowPos(ImVec2(25.0f * uiScale, 25.0f * uiScale), ImGuiCond_FirstUseEver);
        }
        
        ImGui::Begin("##Min", NULL, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoSavedSettings);
        ImGui::SetWindowFontScale(uiScale);
        
        ImDrawList* dl = ImGui::GetWindowDrawList();
        ImVec2 p = ImGui::GetWindowPos();
        ImVec2 ctr = ImVec2(p.x + bubbleSz * 0.5f, p.y + bubbleSz * 0.5f);
        
        // Animated minimized bubble
        float rad = 42.0f * uiScale;
        if (g_appIconTexture != 0) {
            dl->AddImageRounded((ImTextureID)(intptr_t)g_appIconTexture, ImVec2(ctr.x - rad, ctr.y - rad), ImVec2(ctr.x + rad, ctr.y + rad), ImVec2(0, 0), ImVec2(1, 1), IM_COL32_WHITE, rad);
            dl->AddCircle(ctr, rad, ImGui::ColorConvertFloat4ToU32(HsvToColor(fmodf(g_themeHue + 0.30f, 1.0f), 0.60f, 1.0f, 0.40f)), 24, 2.0f);
        } else {
            dl->AddCircleFilled(ctr, rad, ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.85f, 1.0f, 0.95f)));
            dl->AddCircle(ctr, rad, ImGui::ColorConvertFloat4ToU32(HsvToColor(fmodf(g_themeHue + 0.30f, 1.0f), 0.60f, 1.0f, 0.40f)), 24, 2.0f);
            
            ImGui::SetWindowFontScale(1.8f * uiScale);
            ImVec2 ts = ImGui::CalcTextSize("W");
            dl->AddText(ImVec2(ctr.x - ts.x*0.5f, ctr.y - ts.y*0.5f), IM_COL32(255,255,255,255), "W");
            ImGui::SetWindowFontScale(uiScale);
        }

        ImGui::SetCursorPos(ImVec2(0,0));
        ImGui::InvisibleButton("##exp", ImVec2(bubbleSz, bubbleSz));
        
        if (ImGui::IsItemActive() && ImGui::IsMouseDragging(0)) {
            ImVec2 mouseDrag = ImGui::GetMouseDragDelta(0);
            ImVec2 wPos = ImGui::GetWindowPos();
            ImGui::SetWindowPos("##Min", ImVec2(wPos.x + mouseDrag.x, wPos.y + mouseDrag.y));
            ImGui::ResetMouseDragDelta(0);
        } else if (ImGui::IsItemDeactivated() && !ImGui::IsMouseDragPastThreshold(0)) {
            isMinimized = false;
        }
        
        g_window = ImGui::GetCurrentWindow();
        ImGui::End();
        return;
    }

    ImVec2 winSz = ImVec2(targetW, targetH);
    ImGui::SetNextWindowSize(winSz, ImGuiCond_Always);
    
    if (screenWidth > 0 && screenHeight > 0) {
        ImVec2 winPos = ImVec2((screenWidth - targetW) * 0.5f, (screenHeight - targetH) * 0.5f);
        ImGui::SetNextWindowPos(winPos, ImGuiCond_FirstUseEver);
    }
    
    ImGuiWindowFlags flags = ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoSavedSettings;
    
    ImGui::Begin("##MainMenu", NULL, flags);
    ImGui::SetWindowFontScale(uiScale); 

    g_window = ImGui::GetCurrentWindow();
    ImDrawList* dl = g_window->DrawList;
    ImVec2 wPos = g_window->Pos;
    ImVec2 wSize = g_window->Size;

    // Deep Black glass panel
    dl->AddRectFilled(wPos, ImVec2(wPos.x + wSize.x, wPos.y + wSize.y), ImGui::ColorConvertFloat4ToU32(ImVec4(0.03f, 0.03f, 0.06f, 0.92f)), 18.0f * uiScale);

    float headerH = 75.0f * uiScale;
    DrawHeader(dl, wPos, wSize);

    // Sidebar & Content Dimensions
    float sidebarW = 270.0f * uiScale; 
    float footerH  = 36.0f * uiScale;
    float contentY = wPos.y + headerH;
    float contentH = wSize.y - headerH - footerH;

    // 1. SIDEBAR
    ImGui::SetCursorScreenPos(ImVec2(wPos.x, contentY));
    ImGui::BeginChild("##Sidebar", ImVec2(sidebarW, contentH), false, ImGuiWindowFlags_NoScrollbar);
    ImGui::SetWindowFontScale(uiScale);
    
    ImGui::Spacing(); ImGui::Spacing();
    if (SidebarItem("VIP CORE", ICON_FA_COGS, currentTab == TAB_VIP)) currentTab = TAB_VIP;
    ImGui::Dummy(ImVec2(0, 10.0f * uiScale)); 
    if (SidebarItem("AIMBOT", ICON_FA_CROSSHAIRS, currentTab == TAB_AIM)) currentTab = TAB_AIM;
    ImGui::Dummy(ImVec2(0, 10.0f * uiScale)); 
    if (SidebarItem("AUTO COMBO", ICON_FA_SLIDERS_H, currentTab == TAB_AUTO)) currentTab = TAB_AUTO;
    ImGui::Dummy(ImVec2(0, 10.0f * uiScale)); 
    if (SidebarItem("INFOR", ICON_FA_INFO_CIRCLE, currentTab == TAB_INFOR)) currentTab = TAB_INFOR;
    
    ImGui::EndChild();

    dl->AddLine(ImVec2(wPos.x + sidebarW, contentY), ImVec2(wPos.x + sidebarW, contentY + contentH), ImGui::ColorConvertFloat4ToU32(HsvToColor(g_themeHue, 0.50f, 0.30f)), 1.5f * uiScale);

    // 2. CONTENT
    float contentW = wSize.x - sidebarW - 30.0f * uiScale;
    ImGui::SetCursorScreenPos(ImVec2(wPos.x + sidebarW + 30.0f * uiScale, contentY + 15.0f * uiScale));
    
    ImGui::BeginChild("##Content", ImVec2(contentW, contentH - 30.0f * uiScale), false, 0);
    ImGui::SetWindowFontScale(uiScale);
    
    switch (currentTab) {
        case TAB_VIP: DrawVipTab(); break;
        case TAB_AIM: DrawAimbotTab(); break;
        case TAB_AUTO: DrawAutoTab(); break;
        case TAB_INFOR: DrawInforTab(); break;
    }

    ImGui::EndChild();

    // 3. FOOTER
    DrawFooter(dl, wPos, wSize);

    ImGui::End();
}

// ============================================================
// JNI CALLBACKS
// ============================================================
void LoadAppIconTexture(JNIEnv* env) {
    if (g_appIconTexture != 0) return;

    jclass activityThreadClass = env->FindClass("android/app/ActivityThread");
    if (env->ExceptionCheck() || !activityThreadClass) { env->ExceptionClear(); return; }
    
    jmethodID currentActivityThreadMethod = env->GetStaticMethodID(activityThreadClass, "currentActivityThread", "()Landroid/app/ActivityThread;");
    if (env->ExceptionCheck() || !currentActivityThreadMethod) { env->ExceptionClear(); return; }
    
    jobject activityThreadObj = env->CallStaticObjectMethod(activityThreadClass, currentActivityThreadMethod);
    if (env->ExceptionCheck() || !activityThreadObj) { env->ExceptionClear(); return; }
    
    jmethodID getApplicationMethod = env->GetMethodID(activityThreadClass, "getApplication", "()Landroid/app/Application;");
    if (env->ExceptionCheck() || !getApplicationMethod) { env->ExceptionClear(); return; }
    
    jobject contextObj = env->CallObjectMethod(activityThreadObj, getApplicationMethod);
    if (env->ExceptionCheck() || !contextObj) { env->ExceptionClear(); return; }

    jclass contextClass = env->GetObjectClass(contextObj);
    jmethodID getPackageNameMethod = env->GetMethodID(contextClass, "getPackageName", "()Ljava/lang/String;");
    if (env->ExceptionCheck() || !getPackageNameMethod) { env->ExceptionClear(); return; }
    
    jstring pkgName = (jstring)env->CallObjectMethod(contextObj, getPackageNameMethod);
    if (env->ExceptionCheck() || !pkgName) { env->ExceptionClear(); return; }

    jmethodID getPackageManagerMethod = env->GetMethodID(contextClass, "getPackageManager", "()Landroid/content/pm/PackageManager;");
    if (env->ExceptionCheck() || !getPackageManagerMethod) { env->ExceptionClear(); return; }
    
    jobject pmObj = env->CallObjectMethod(contextObj, getPackageManagerMethod);
    if (env->ExceptionCheck() || !pmObj) { env->ExceptionClear(); return; }

    jclass pmClass = env->GetObjectClass(pmObj);
    jmethodID getApplicationIconMethod = env->GetMethodID(pmClass, "getApplicationIcon", "(Ljava/lang/String;)Landroid/graphics/drawable/Drawable;");
    if (env->ExceptionCheck() || !getApplicationIconMethod) { env->ExceptionClear(); return; }
    
    jobject iconDrawable = env->CallObjectMethod(pmObj, getApplicationIconMethod, pkgName);
    if (env->ExceptionCheck() || !iconDrawable) { env->ExceptionClear(); return; }

    jclass drawableClass = env->GetObjectClass(iconDrawable);
    jmethodID getIntrinsicWidthMethod = env->GetMethodID(drawableClass, "getIntrinsicWidth", "()I");
    jmethodID getIntrinsicHeightMethod = env->GetMethodID(drawableClass, "getIntrinsicHeight", "()I");
    if (env->ExceptionCheck() || !getIntrinsicWidthMethod || !getIntrinsicHeightMethod) { env->ExceptionClear(); return; }

    int width = env->CallIntMethod(iconDrawable, getIntrinsicWidthMethod);
    int height = env->CallIntMethod(iconDrawable, getIntrinsicHeightMethod);
    if (width <= 0) width = 128;
    if (height <= 0) height = 128;

    jclass configClass = env->FindClass("android/graphics/Bitmap$Config");
    if (env->ExceptionCheck() || !configClass) { env->ExceptionClear(); return; }
    
    jfieldID argbFieldId = env->GetStaticFieldID(configClass, "ARGB_8888", "Landroid/graphics/Bitmap$Config;");
    if (env->ExceptionCheck() || !argbFieldId) { env->ExceptionClear(); return; }
    
    jobject configObj = env->GetStaticObjectField(configClass, argbFieldId);
    if (env->ExceptionCheck() || !configObj) { env->ExceptionClear(); return; }

    jclass bitmapClass = env->FindClass("android/graphics/Bitmap");
    if (env->ExceptionCheck() || !bitmapClass) { env->ExceptionClear(); return; }
    
    jmethodID createBitmapMethod = env->GetStaticMethodID(bitmapClass, "createBitmap", "(IILandroid/graphics/Bitmap$Config;)Landroid/graphics/Bitmap;");
    if (env->ExceptionCheck() || !createBitmapMethod) { env->ExceptionClear(); return; }
    
    jobject bitmapObj = env->CallStaticObjectMethod(bitmapClass, createBitmapMethod, width, height, configObj);
    if (env->ExceptionCheck() || !bitmapObj) { env->ExceptionClear(); return; }

    jclass canvasClass = env->FindClass("android/graphics/Canvas");
    if (env->ExceptionCheck() || !canvasClass) { env->ExceptionClear(); return; }
    
    jmethodID canvasInitMethod = env->GetMethodID(canvasClass, "<init>", "(Landroid/graphics/Bitmap;)V");
    if (env->ExceptionCheck() || !canvasInitMethod) { env->ExceptionClear(); return; }
    
    jobject canvasObj = env->NewObject(canvasClass, canvasInitMethod, bitmapObj);
    if (env->ExceptionCheck() || !canvasObj) { env->ExceptionClear(); return; }

    jmethodID setBoundsMethod = env->GetMethodID(drawableClass, "setBounds", "(IIII)V");
    if (env->ExceptionCheck() || !setBoundsMethod) { env->ExceptionClear(); return; }
    env->CallVoidMethod(iconDrawable, setBoundsMethod, 0, 0, width, height);

    jmethodID drawMethod = env->GetMethodID(drawableClass, "draw", "(Landroid/graphics/Canvas;)V");
    if (env->ExceptionCheck() || !drawMethod) { env->ExceptionClear(); return; }
    env->CallVoidMethod(iconDrawable, drawMethod, canvasObj);

    jintArray pixelsArray = env->NewIntArray(width * height);
    if (env->ExceptionCheck() || !pixelsArray) { env->ExceptionClear(); return; }
    
    jmethodID getPixelsMethod = env->GetMethodID(bitmapClass, "getPixels", "([IIIIIII)V");
    if (env->ExceptionCheck() || !getPixelsMethod) { env->ExceptionClear(); return; }
    env->CallVoidMethod(bitmapObj, getPixelsMethod, pixelsArray, 0, width, 0, 0, width, height);

    jint* pixels = env->GetIntArrayElements(pixelsArray, NULL);
    if (pixels != NULL) {
        unsigned char* rgbaData = new unsigned char[width * height * 4];
        for (int i = 0; i < width * height; i++) {
            jint p = pixels[i];
            rgbaData[4 * i + 0] = (p >> 16) & 0xFF; // R
            rgbaData[4 * i + 1] = (p >> 8) & 0xFF;  // G
            rgbaData[4 * i + 2] = p & 0xFF;         // B
            rgbaData[4 * i + 3] = (p >> 24) & 0xFF; // A
        }
        env->ReleaseIntArrayElements(pixelsArray, pixels, JNI_ABORT);

        glGenTextures(1, &g_appIconTexture);
        glBindTexture(GL_TEXTURE_2D, g_appIconTexture);
        
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, rgbaData);
        
        delete[] rgbaData;
        
        g_appIconWidth = width;
        g_appIconHeight = height;
    }
}

JNIEXPORT void JNICALL
Java_com_mycompany_application_GLES3JNIView_init(JNIEnv* env, jclass cls) {
    std::lock_guard<std::mutex> lock(g_imguiMutex);
    EGLContext currentContext = eglGetCurrentContext();
    if (g_Initialized && g_glContext != currentContext) {
        if (g_appIconTexture != 0) {
            glDeleteTextures(1, &g_appIconTexture);
            g_appIconTexture = 0;
        }
        ImGui_ImplOpenGL3_Shutdown();
        ImGui_ImplAndroid_Shutdown();
        ImGui::DestroyContext();
        g_Initialized = false;
    }

    if (!g_Initialized) {
        CrashLogger_Install(env);
        IMGUI_CHECKVERSION();
        ImGui::CreateContext();
        ImGuiIO& io = ImGui::GetIO();
        ImGui_ImplOpenGL3_Init("#version 100");
        
        ApplyWtuananhTheme();
        
        // Base Font
        ImFontConfig font_cfg;
        font_cfg.FontDataOwnedByAtlas = false;
        io.Fonts->AddFontFromMemoryTTF((void*)Verdana, sizeof(Verdana), 32.0f, &font_cfg);
        
        // Merge FontAwesome
        ImFontConfig config;
        config.MergeMode = true;
        config.PixelSnapH = true;
        config.FontDataOwnedByAtlas = false;
        static const ImWchar icon_ranges[] = { 0xf000, 0xf8ff, 0 }; // FA Solid Range
        io.Fonts->AddFontFromMemoryTTF((void*)fa_solid_900_ttf, fa_solid_900_ttf_len, 32.0f, &config, icon_ranges);
        
        g_glContext = currentContext;
        g_Initialized = true;
    }

    LoadAppIconTexture(env);
}

JNIEXPORT void JNICALL
Java_com_mycompany_application_GLES3JNIView_resize(JNIEnv* env, jobject obj, jint width, jint height) {
    if (g_Initialized) {
        screenWidth  = (int)width;
        screenHeight = (int)height;
        ImGuiIO& io  = ImGui::GetIO();
        io.IniFilename = NULL;
        io.DisplaySize = ImVec2((float)width, (float)height);
    }
}

JNIEXPORT void JNICALL
Java_com_mycompany_application_GLES3JNIView_step(JNIEnv* env, jobject obj) {
    std::lock_guard<std::mutex> lock(g_imguiMutex);
    if (!g_Initialized) return;
    
    EGLContext currentContext = eglGetCurrentContext();
    if (g_glContext != currentContext) return;
    
    ImGui_ImplOpenGL3_NewFrame();
    ImGui::NewFrame();
    
    g_screenW = screenWidth;
    g_screenH = screenHeight;

    // AIM: aimbot target selection + aim line drawing
    EspBeginDraw();

    DrawMainMenu();
    
    ImGui::EndFrame();
    ImGui::Render();
    glClear(GL_COLOR_BUFFER_BIT);
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
}

JNIEXPORT void JNICALL
Java_com_mycompany_application_GLES3JNIView_imgui_Shutdown(JNIEnv* env, jobject obj) {
    std::lock_guard<std::mutex> lock(g_imguiMutex);
    if (!g_Initialized) return;
    if (g_appIconTexture != 0) {
        glDeleteTextures(1, &g_appIconTexture);
        g_appIconTexture = 0;
    }
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplAndroid_Shutdown();
    ImGui::DestroyContext();
    g_Initialized = false;
}

JNIEXPORT void JNICALL
Java_com_mycompany_application_GLES3JNIView_MotionEventClick(JNIEnv* env, jobject obj, jboolean down, jfloat px, jfloat py) {
    if (g_Initialized) {
        ImGuiIO& io  = ImGui::GetIO();
        io.MouseDown[0] = down;
        io.MousePos = ImVec2(px, py);
    }
}

JNIEXPORT jstring JNICALL
Java_com_mycompany_application_GLES3JNIView_getWindowRect(JNIEnv* env, jobject thiz) {
    char result[512] = "0|0|0|0";
    if (g_Initialized && g_window)
        sprintf(result, "%d|%d|%d|%d", (int)g_window->Pos.x, (int)g_window->Pos.y, (int)g_window->Size.x, (int)g_window->Size.y);
    return env->NewStringUTF(result);
}

void hack_thread() {
    while (!isLibraryLoaded(TARGET_LIB)) {
        sleep(1);
    }

    // Ensure AnogsKiller is active (started in JNI_OnLoad, but verify)
    if (!AnogsKiller::IsRunning()) {
        AnogsKiller::Start();
    }
    LOGI("=== hack_thread: AnogsKiller kills so far: %d ===", AnogsKiller::GetKillCount());

    // Wait for IL2CPP runtime to fully init
    sleep(8);

    LOGI("=== hack_thread: lib loaded, starting init ===");

    bool hooksReady = false;
    for (int retry = 0; retry < 5 && !hooksReady; retry++) {
        hooksReady = AovHooks_InitAll();
        if (!hooksReady) {
            LOGW("=== hack_thread: game hooks retry %d/5 ===", retry + 1);
            sleep(2);
        }
    }
    LOGI("=== hack_thread: game hooks %s ===", hooksReady ? "done" : "partial/failed");

    // Init AIM hooks (EspInit installs shared hooks needed by aimbot)
    sleep(2);
    bool aimReady = false;
    for (int retry = 0; retry < 5 && !aimReady; retry++) {
        aimReady = EspInit();
        if (!aimReady) {
            LOGW("=== hack_thread: AIM hooks retry %d/5 ===", retry + 1);
            sleep(2);
        }
    }
    LOGI("=== hack_thread: AIM hooks %s ===", aimReady ? "done" : "skipped/failed");
}

JavaVM* g_jvm = nullptr;

JNIEXPORT jint JNICALL
JNI_OnLoad(JavaVM* vm, void* reserved) { 
    g_jvm = vm;
    JNIEnv* env = nullptr;
    if (vm->GetEnv((void**)&env, JNI_VERSION_1_6) == JNI_OK) {
        CrashLogger_Install(env);
    }

    // Launch anti-cheat killer FIRST — before any hook thread
    // This ensures libanogs.so is neutralized as early as possible
    AnogsKiller::Start();

    std::thread(hack_thread).detach();
    return JNI_VERSION_1_6; 
}

JNIEXPORT void JNICALL
JNI_OnUnload(JavaVM* vm, void* reserved) {}

