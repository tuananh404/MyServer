package com.mycompany.application;
import android.app.Activity;
import android.content.Context;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.widget.LinearLayout;
import android.view.WindowManager;
import com.mycompany.application.GLES3JNIView;
import java.io.InputStream;
import android.view.WindowManager.LayoutParams;
import android.view.Display;
import android.provider.Settings;
import android.widget.Toast;
import android.content.Intent;
import android.Manifest;
import android.net.Uri;
import java.io.IOException;
import java.io.File;
import android.util.Log;
import java.io.InputStream;
import java.io.IOException;
import java.io.FileOutputStream;
import java.io.DataOutputStream;
import android.content.res.AssetManager;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import android.content.pm.PackageManager;
public class MainActivity extends Activity {
     
    public static WindowManager manager;
    public static  WindowManager.LayoutParams vParams;
    public static Context sContext;
    
    public static  View vTouch;
    public static  WindowManager windowManager,xfqManager;
    
    public static int 真实宽;//分辨率x
    public static int 真实高;//分辨率y

    // ============================================================
    // ServerKey Authentication Integration
    // ============================================================
    public static String sApiUrl = "http://10.0.2.2:3000/api/client/login";
    public static int sLoginStatus = 0; // 0 = Idle, 1 = Logging In, 2 = Success, 3 = Failed
    public static String sErrorMessage = "";
    public static String sTokenName = "";
    public static String sDisplayText = "";

    public static String getHWID(Context context) {
        try {
            return Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
        } catch (Exception e) {
            return "UNKNOWN_HWID";
        }
    }

    public static void saveKey(Context context, String key) {
        try {
            java.io.File file = new java.io.File(context.getFilesDir(), "key.txt");
            java.io.FileOutputStream fos = new java.io.FileOutputStream(file);
            fos.write(key.getBytes());
            fos.close();
        } catch (Exception e) {
            Log.e("ServerKey", "Failed to save key", e);
        }
    }

    public static String loadKey(Context context) {
        try {
            java.io.File file = new java.io.File(context.getFilesDir(), "key.txt");
            if (!file.exists()) return "";
            byte[] buffer = new byte[(int) file.length()];
            java.io.FileInputStream fis = new java.io.FileInputStream(file);
            fis.read(buffer);
            fis.close();
            return new String(buffer).trim();
        } catch (Exception e) {
            return "";
        }
    }

    public static void deleteKey(Context context) {
        try {
            java.io.File file = new java.io.File(context.getFilesDir(), "key.txt");
            if (file.exists()) file.delete();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static void startLoginThread(final Context context, final String tokenString, final String keyString) {
        sLoginStatus = 1;
        sErrorMessage = "";
        new Thread(new Runnable() {
            @Override
            public void run() {
                java.net.HttpURLConnection conn = null;
                try {
                    java.net.URL url = new java.net.URL(sApiUrl);
                    conn = (java.net.HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                    conn.setDoOutput(true);
                    conn.setDoInput(true);
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);

                    // Build JSON payload
                    String hwid = getHWID(context);
                    org.json.JSONObject payload = new org.json.JSONObject();
                    payload.put("token_string", tokenString);
                    payload.put("key_string", keyString);
                    payload.put("hwid", hwid);

                    java.io.OutputStream os = conn.getOutputStream();
                    os.write(payload.toString().getBytes("UTF-8"));
                    os.close();

                    int responseCode = conn.getResponseCode();
                    java.io.InputStream is;
                    if (responseCode >= 200 && responseCode < 300) {
                        is = conn.getInputStream();
                    } else {
                        is = conn.getErrorStream();
                    }

                    java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(is, "UTF-8"));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) {
                        sb.append(line);
                    }
                    br.close();
                    is.close();

                    org.json.JSONObject json = new org.json.JSONObject(sb.toString());
                    boolean success = json.optBoolean("success", false);
                    if (success) {
                        sTokenName = json.optString("token_name", "");
                        sDisplayText = json.optString("display_text", "ServerKey by #wtuananh6868");
                        saveKey(context, keyString);
                        sLoginStatus = 2; // Success
                    } else {
                        sErrorMessage = json.optString("message", "Đăng nhập thất bại");
                        if (sErrorMessage.contains("expired") || sErrorMessage.contains("banned") || sErrorMessage.contains("cấm") || sErrorMessage.contains("Hết hạn") || sErrorMessage.contains("đã dùng")) {
                            deleteKey(context);
                        }
                        sLoginStatus = 3; // Failed
                    }
                } catch (Exception e) {
                    sErrorMessage = "Lỗi kết nối: " + e.getMessage();
                    sLoginStatus = 3; // Failed
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                }
            }
        }).start();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!Settings.canDrawOverlays(this)) {
            //Toast.makeText(this, "请授权应用悬浮窗权限", Toast.LENGTH_LONG).show();
            //startActivityForResult(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())), 0);
        }
        Start(this);
    }
    
    public static void Start(Context context) {
        sContext = context;
        System.loadLibrary("wtuananhVIP");
        manager = ((Activity) context).getWindowManager();
        vParams = getAttributes(false);
        WindowManager.LayoutParams wParams = getAttributes(true);
        GLES3JNIView display = new GLES3JNIView(context);
        vTouch = new View(context);
        manager.addView(vTouch, vParams);
        manager.addView(display, wParams);

        vTouch.setOnTouchListener(new View.OnTouchListener() {
                @Override
                public boolean onTouch(View v, MotionEvent event) {
                    int action = event.getAction();
                    switch (action) {
                        case MotionEvent.ACTION_MOVE:
                        case MotionEvent.ACTION_DOWN:
                        case MotionEvent.ACTION_UP:
                            GLES3JNIView.MotionEventClick(action != MotionEvent.ACTION_UP, event.getRawX(), event.getRawY());
                            break;
                        default:
                            break;
                    }
                   return false;
                }
            });
        final Handler handler = new Handler();
        handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    try {
                        String rect[] = GLES3JNIView.getWindowRect().split("\\|");
                        vParams.x = Integer.parseInt(rect[0]);
                        vParams.y = Integer.parseInt(rect[1]);
                        vParams.width = Integer.parseInt(rect[2]);
                        vParams.height = Integer.parseInt(rect[3]);
                        manager.updateViewLayout(vTouch, vParams);
                    } catch (Exception e) {
                    }
                    handler.postDelayed(this, 20);
                }
            }, 20);          
        }
    public static WindowManager.LayoutParams getAttributes(boolean isWindow) {
        WindowManager.LayoutParams params = new WindowManager.LayoutParams();               
        int aditionalFlags=0;
        if (Build.VERSION.SDK_INT >= 11)
            aditionalFlags = WindowManager.LayoutParams.FLAG_SPLIT_TOUCH;
        if (Build.VERSION.SDK_INT >=  3)
            aditionalFlags = aditionalFlags | WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM;
        params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT | WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT | WindowManager.LayoutParams.MATCH_PARENT,
			0,
			0,
			WindowManager.LayoutParams.TYPE_APPLICATION,
			WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
			WindowManager.LayoutParams.FLAG_LAYOUT_IN_OVERSCAN |
			WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN |
			WindowManager.LayoutParams.FLAG_SPLIT_TOUCH | aditionalFlags,
			PixelFormat.TRANSPARENT);

        if (isWindow) {
            params.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        }
        params.format = PixelFormat.RGBA_8888;            // 设置图片格式，效果为背景透明
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        params.gravity = Gravity.LEFT | Gravity.TOP;        // 调整悬浮窗显示的停靠位置为左侧置顶
        params.x = params.y = 0;
        params.width = params.height = isWindow ? WindowManager.LayoutParams.MATCH_PARENT : 0;
        return params;
    }
} 

