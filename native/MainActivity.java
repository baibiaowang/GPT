package com.baibiaowang.stockjudge;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.widget.Toast;
import android.provider.MediaStore;
import android.provider.DocumentsContract;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import android.util.Base64;
import android.os.Environment;

/**
 * 支持「用其他应用打开」一个 txt 文件后直接解密。
 *
 * 做法：收到 ACTION_VIEW 的 text/plain 后，把文件内容落到 app 私有目录
 *       (files/incoming.txt)，再把路径注入到 WebView 的
 *       window.__SJ_INCOMING_PATH__；前端轮询到该变量后，用
 *       Capacitor.convertFileSrc() 读取并解密。
 *
 * 注意：注入的是「路径」而不是文件内容，避免大字符串走 evaluateJavascript。
 */
public class MainActivity extends BridgeActivity {

    private static final int EXPORT_REQUEST = 9917;
    private static final int IMPORT_REQUEST = 9918;
    private String pendingExportName;
    private String pendingExportText;

    private long apkDownloadId = -1L;
    private String pendingInstallUri;
    private DownloadManager apkDownloadManager;
    private final Handler apkHandler = new Handler(Looper.getMainLooper());
    private Runnable apkProgressTask;
    private boolean apkReceiverRegistered = false;

    private final BroadcastReceiver apkDownloadReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
            if (id != apkDownloadId) return;
            checkApkDownload(true);
        }
    };

    private static final String INCOMING_FILE = "incoming.txt";
    /** 与前端 POLL_MAX 保持一致：240 * 500ms = 120s */
    private static final int MAX_ATTEMPTS = 240;
    private static final long RETRY_MS = 500L;
    /** 与前端 decryptBytes() 的 `u8.length < 33` 保持一致 */
    private static final int MIN_BYTES = 33;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        installBackHandler();
        installPinchZoom();
        installNativeBridge();
        registerApkDownloadReceiver();
        handle(getIntent());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingInstallUri != null) {
            final String uri = pendingInstallUri;
            pendingInstallUri = null;
            apkHandler.postDelayed(new Runnable() {
                @Override public void run() { installDownloadedApk(uri); }
            }, 250L);
        }
    }

    /** App-local JS bridge: export user backup to Downloads, download updates, and open external links. */
    private void installNativeBridge() {
        final WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
        if (wv == null) {
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override public void run() { installNativeBridge(); }
            }, 250L);
            return;
        }
        wv.addJavascriptInterface(new Object() {
            @JavascriptInterface public void saveTextFile(final String filename, final String content) {
                new Thread(new Runnable() {
                    @Override public void run() { saveExportFile(filename, content); }
                }).start();
            }
            @JavascriptInterface public void downloadApk(final String url, final String filename) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { startApkDownload(url, filename); }
                });
            }
            @JavascriptInterface public void openBackupPicker() {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        try {
                            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                            i.addCategory(Intent.CATEGORY_OPENABLE);
                            i.setType("application/json");
                            if (Build.VERSION.SDK_INT >= 26) {
                                Uri downloads = DocumentsContract.buildDocumentUri("com.android.providers.downloads.documents", "downloads");
                                i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, downloads);
                            }
                            startActivityForResult(i, IMPORT_REQUEST);
                        } catch (Exception e) {
                            try {
                                Intent fallback = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                                fallback.addCategory(Intent.CATEGORY_OPENABLE);
                                fallback.setType("*/*");
                                startActivityForResult(fallback, IMPORT_REQUEST);
                            } catch (Exception ignored) { }
                        }
                    }
                });
            }
            @JavascriptInterface public void openUrl(final String url) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        try {
                            Uri u = Uri.parse(url);
                            if (!"https".equalsIgnoreCase(u.getScheme())) return;
                            Intent i = new Intent(Intent.ACTION_VIEW, u);
                            startActivity(i);
                        } catch (Exception ignored) { }
                    }
                });
            }
        }, "AndroidNative");
    }

    private void registerApkDownloadReceiver() {
        if (apkReceiverRegistered) return;
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(apkDownloadReceiver, new android.content.IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(apkDownloadReceiver, new android.content.IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
        }
        apkReceiverRegistered = true;
    }

    private void startApkDownload(final String url, final String filename) {
        try {
            Uri u = Uri.parse(url);
            if (!"https".equalsIgnoreCase(u.getScheme())) {
                notifyJsDownloadFailed("更新地址必须使用 HTTPS");
                return;
            }
            if (apkDownloadManager == null) {
                apkDownloadManager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            }
            if (apkDownloadManager == null) {
                notifyJsDownloadFailed("系统下载服务不可用");
                return;
            }

            String safeName = (filename == null || filename.trim().isEmpty()) ? "stock-judge-update.apk" : filename.trim();
            if (!safeName.toLowerCase().endsWith(".apk")) safeName += ".apk";
            safeName = "股票判断机-" + safeName;

            DownloadManager.Request req = new DownloadManager.Request(u);
            req.setTitle("股票判断机更新");
            req.setDescription("正在下载 " + safeName);
            req.setMimeType("application/vnd.android.package-archive");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (Build.VERSION.SDK_INT >= 24) {
                req.setAllowedOverMetered(true);
                req.setAllowedOverRoaming(true);
            }
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "股票判断机/" + safeName);

            apkDownloadId = apkDownloadManager.enqueue(req);
            notifyJsDownloadProgress(0, "running", "正在下载…");
            startApkProgressPolling();
        } catch (Exception e) {
            notifyJsDownloadFailed("APK 下载失败：" + e.getMessage());
        }
    }

    private void startApkProgressPolling() {
        if (apkProgressTask != null) apkHandler.removeCallbacks(apkProgressTask);
        apkProgressTask = new Runnable() {
            @Override public void run() {
                if (apkDownloadId == -1L) return;
                checkApkDownload(false);
                if (apkDownloadId != -1L) apkHandler.postDelayed(this, 300L);
            }
        };
        apkHandler.post(apkProgressTask);
    }

    private void checkApkDownload(boolean fromBroadcast) {
        if (apkDownloadId == -1L) return;
        DownloadManager.Query q = new DownloadManager.Query();
        q.setFilterById(apkDownloadId);
        try (android.database.Cursor c = apkDownloadManager.query(q)) {
            if (c == null || !c.moveToFirst()) {
                if (fromBroadcast) {
                    notifyJsDownloadFailed("找不到下载任务");
                    apkDownloadId = -1L;
                }
                return;
            }

            int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status == DownloadManager.STATUS_PENDING) {
                notifyJsDownloadProgress(0, "pending", "等待下载…");
                return;
            }
            if (status == DownloadManager.STATUS_RUNNING) {
                long done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                int pct = total > 0 ? (int)Math.max(0, Math.min(99, Math.round(done * 100f / total))) : 0;
                notifyJsDownloadProgress(pct, "running", total > 0 ? "正在下载 " + pct + "%" : "正在下载…");
                return;
            }
            if (status == DownloadManager.STATUS_PAUSED) {
                notifyJsDownloadProgress(0, "paused", "下载暂停，等待恢复…");
                return;
            }
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                String localUri = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
                apkDownloadId = -1L;
                if (apkProgressTask != null) {
                    apkHandler.removeCallbacks(apkProgressTask);
                    apkProgressTask = null;
                }
                notifyJsDownloadComplete();
                apkHandler.postDelayed(new Runnable() {
                    @Override public void run() { installDownloadedApk(localUri); }
                }, 350L);
                return;
            }

            int reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
            apkDownloadId = -1L;
            if (apkProgressTask != null) {
                apkHandler.removeCallbacks(apkProgressTask);
                apkProgressTask = null;
            }
            notifyJsDownloadFailed("APK 下载失败（原因 " + reason + "）");
        } catch (Exception e) {
            notifyJsDownloadFailed("下载状态读取失败：" + e.getMessage());
            apkDownloadId = -1L;
        }
    }

    private void notifyJsDownloadProgress(final int percent, final String status, final String message) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
                if (wv == null) return;
                String js = "window.__sjApkDownloadProgress&&window.__sjApkDownloadProgress(" +
                    percent + "," + jsStr(status) + "," + jsStr(message) + ");";
                try { wv.evaluateJavascript(js, null); } catch (Exception ignored) { }
            }
        });
    }

    private void notifyJsDownloadComplete() {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
                if (wv == null) return;
                try { wv.evaluateJavascript("window.__sjApkDownloadComplete&&window.__sjApkDownloadComplete();", null); }
                catch (Exception ignored) { }
            }
        });
    }

    private void notifyJsDownloadFailed(final String message) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
                if (wv == null) return;
                String js = "window.__sjApkDownloadFailed&&window.__sjApkDownloadFailed(" + jsStr(message) + ");";
                try { wv.evaluateJavascript(js, null); } catch (Exception ignored) { }
            }
        });
    }

    private void installDownloadedApk(String localUri) {
        try {
            if (localUri == null || localUri.trim().isEmpty()) throw new Exception("安装文件地址为空");
            Uri uri = Uri.parse(localUri);
            if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                pendingInstallUri = localUri;
                notifyJsInstallNeedsPermission();
                try {
                    Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                    startActivity(settingsIntent);
                } catch (Exception ignored) { }
                return;
            }
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            final String msg = "安装 APK 失败：" + e.getMessage();
            Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            notifyJsDownloadFailed(msg);
        }
    }

    private void notifyJsInstallNeedsPermission() {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                Toast.makeText(MainActivity.this, "请允许“股票判断机”安装未知应用，然后返回继续安装。", Toast.LENGTH_LONG).show();
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (apkProgressTask != null) {
            apkHandler.removeCallbacks(apkProgressTask);
            apkProgressTask = null;
        }
        if (apkReceiverRegistered) {
            try { unregisterReceiver(apkDownloadReceiver); } catch (Exception ignored) { }
            apkReceiverRegistered = false;
        }
        super.onDestroy();
    }

    private void saveExportFile(final String filename, final String content) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/股票判断机");
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new Exception("无法创建下载文件");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new Exception("无法打开下载文件");
                    out.write(content.getBytes(StandardCharsets.UTF_8));
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(uri, values, null, null);
                runOnUiThread(new Runnable(){@Override public void run(){Toast.makeText(MainActivity.this,"已保存到 下载 / 股票判断机",Toast.LENGTH_LONG).show();}});
                return;
            }
            pendingExportName = filename;
            pendingExportText = content;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, filename);
            startActivityForResult(i, EXPORT_REQUEST);
        } catch (Exception e) {
            runOnUiThread(new Runnable(){@Override public void run(){Toast.makeText(MainActivity.this,"导出失败："+e.getMessage(),Toast.LENGTH_LONG).show();}});
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == IMPORT_REQUEST && resultCode == RESULT_OK && data != null && data.getData() != null) {
            final Uri uri = data.getData();
            new Thread(new Runnable() {
                @Override public void run() {
                    String text = null;
                    try (InputStream in = getContentResolver().openInputStream(uri)) {
                        if (in == null) throw new Exception("无法读取备份文件");
                        ByteArrayOutputStream bos = new ByteArrayOutputStream();
                        byte[] buf = new byte[16384]; int n;
                        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                        text = new String(bos.toByteArray(), StandardCharsets.UTF_8);
                    } catch (Exception e) {
                        final String msg = "恢复失败："+e.getMessage();
                        runOnUiThread(new Runnable(){@Override public void run(){Toast.makeText(MainActivity.this,msg,Toast.LENGTH_LONG).show();}});
                        return;
                    }
                    final String payload = text;
                    runOnUiThread(new Runnable(){@Override public void run(){
                        WebView wv = (getBridge()==null)?null:getBridge().getWebView();
                        if(wv!=null) wv.evaluateJavascript("window.restoreBackupText && window.restoreBackupText("+jsStr(payload)+");", null);
                    }});
                }
            }).start();
            return;
        }
        if (requestCode != EXPORT_REQUEST || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
            if (out == null) throw new Exception("无法打开目标文件");
            out.write((pendingExportText == null ? "" : pendingExportText).getBytes(StandardCharsets.UTF_8));
            Toast.makeText(this,"导出成功",Toast.LENGTH_LONG).show();
        } catch (Exception e) { Toast.makeText(this,"导出失败："+e.getMessage(),Toast.LENGTH_LONG).show(); }
        pendingExportName=null; pendingExportText=null;
    }

    /**
     * ★ 2026-09-20 新增：把系统返回键接进页面层级。
     *
     * 为什么必须在这一层做（不是前端没写，是前端根本收不到）：
     *   Capacitor 核心的 BridgeActivity **没有覆写 onBackPressed()** ——
     *   读过官方源码，整个类里没有这个方法；项目也没有装 @capacitor/app。
     *   所以系统返回键根本走不到 WebView，直接落到 Activity 默认的 finish()，
     *   表现为「按一下返回就退到桌面」。
     *   前端那套 history.pushState / popstate 层级因此一次都没被触发过
     *   （浏览器里点返回键 = 浏览历史后退，所以浏览器测能过，真机不能）。
     *
     * 逻辑：
     *   WebView 还有历史（详情页 / 弹层开着）→ goBack()，由前端 popstate 逐层关闭；
     *   历史空了 → 关掉自己再交回系统，这时才是真正退出 App。
     *
     * 用 OnBackPressedCallback 而不是覆写已废弃的 onBackPressed()，
     * 这样 Android 13+ 的预测性返回（predictive back）也走得通。
     */
    private void installBackHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
                if (wv != null && wv.canGoBack()) {
                    wv.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    /**
     * 公司概况（跨域 iframe）专用双指缩放：原生层识别 ScaleGesture，
     * 前端根据双指焦点是否位于 .ov-frame 决定是否调整 iframe 比例。
     */
    private void installPinchZoom() {
        final WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
        if (wv == null) {
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override public void run() { installPinchZoom(); }
            }, 250L);
            return;
        }
        wv.getSettings().setSupportZoom(false);
        wv.getSettings().setBuiltInZoomControls(false);

        final float density = getResources().getDisplayMetrics().density;
        final ScaleGestureDetector detector = new ScaleGestureDetector(this,
            new ScaleGestureDetector.SimpleOnScaleGestureListener() {
                private float pendingScale = 1f;
                private long lastDispatch = 0L;

                @Override public boolean onScaleBegin(ScaleGestureDetector d) {
                    pendingScale = 1f;
                    lastDispatch = 0L;
                    return true;
                }

                @Override public boolean onScale(ScaleGestureDetector d) {
                    pendingScale *= d.getScaleFactor();
                    final long now = SystemClock.uptimeMillis();
                    if (now - lastDispatch >= 35L) {
                        final float factor = pendingScale;
                        pendingScale = 1f;
                        lastDispatch = now;
                        dispatchOverviewScale(wv, factor, d.getFocusX() / density, d.getFocusY() / density);
                    }
                    return true;
                }

                @Override public void onScaleEnd(ScaleGestureDetector d) {
                    if (Math.abs(pendingScale - 1f) > 0.001f) {
                        final float factor = pendingScale;
                        pendingScale = 1f;
                        dispatchOverviewScale(wv, factor, d.getFocusX() / density, d.getFocusY() / density);
                    }
                }
            });

        wv.setOnTouchListener(new android.view.View.OnTouchListener() {
            @Override public boolean onTouch(android.view.View v, MotionEvent event) {
                detector.onTouchEvent(event);
                return detector.isInProgress();
            }
        });
    }

    private void dispatchOverviewScale(WebView wv, float factor, float x, float y) {
        if (factor <= 0f) return;
        final String js = "window.__sjPinchScale && window.__sjPinchScale(" +
            Float.toString(factor) + "," + Float.toString(x) + "," + Float.toString(y) + ");";
        try { wv.evaluateJavascript(js, null); } catch (Exception ignored) { }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    private void handle(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return;
        final Uri uri = intent.getData();
        if (uri == null) return;

        new Thread(new Runnable() {
            @Override public void run() {
                final String path = copyToPrivate(uri);
                if (path == null) return;
                new Handler(Looper.getMainLooper()).post(new Runnable() {
                    @Override public void run() { injectWhenReady(path, 0); }
                });
            }
        }).start();
    }

    /**
     * ★ 2026-09-20 修：原实现只要 getWebView() 非 null 就注入。
     *   冷启动时 WebView 对象已经存在、但页面还没加载完，注入的变量会被
     *   随后的页面加载冲掉 —— 前端轮询 30 秒也拿不到，表现为
     *   「用其他应用打开 txt，什么都没发生」。
     *   热启动（App 已在前台，走 onNewIntent）时页面已就绪，所以只有冷启动坏，
     *   排查时极易误判成「intent-filter 没生效」。
     *   现在先问 document.readyState，只有 complete 才注入，否则每 500ms 重试。
     */
    private void injectWhenReady(final String path, final int attempt) {
        if (attempt >= MAX_ATTEMPTS) return;
        final WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
        if (wv == null) { retry(path, attempt); return; }
        try {
            wv.evaluateJavascript("document.readyState", new ValueCallback<String>() {
                @Override public void onReceiveValue(String v) {
                    if (v != null && v.indexOf("complete") >= 0) {
                        try {
                            wv.evaluateJavascript(
                                "window.__SJ_INCOMING_PATH__=" + jsStr(path) + ";", null);
                        } catch (Exception ignored) { }
                    } else {
                        retry(path, attempt);
                    }
                }
            });
        } catch (Exception e) {
            retry(path, attempt);
        }
    }

    private void retry(final String path, final int attempt) {
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override public void run() { injectWhenReady(path, attempt + 1); }
        }, RETRY_MS);
    }

    /**
     * ★ 2026-09-20 新增：转义成 JS 双引号字符串字面量。
     *   原实现直接把路径拼进 `"...\" + path + "\"..."` ——
     *   路径里只要出现引号或反斜杠就会把注入的 JS 写成语法错误。
     *   （同一个「注入字符串不转义」的家族问题在 inject.mjs 里已经犯过一次，
     *   这次把原生侧也补上。）
     */
    private static String jsStr(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"':  sb.append("\\\""); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) {
                        sb.append("\\u").append(pad4(Integer.toHexString(c)));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append("\"").toString();
    }

    private static String pad4(String hex) {
        StringBuilder sb = new StringBuilder(hex);
        while (sb.length() < 4) sb.insert(0, '0');
        return sb.toString();
    }

    /** 把外部 URI 的内容复制到 app 私有目录，返回绝对路径；失败返回 null */
    private String copyToPrivate(Uri uri) {
        InputStream in = null;
        FileOutputStream fos = null;
        try {
            in = getContentResolver().openInputStream(uri);
            if (in == null) return null;

            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            byte[] data = bos.toByteArray();
            if (data.length < MIN_BYTES) return null;

            File out = new File(getFilesDir(), INCOMING_FILE);
            fos = new FileOutputStream(out);
            fos.write(data);
            fos.flush();
            return out.getAbsolutePath();
        } catch (Exception e) {
            return null;
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) { }
            try { if (fos != null) fos.close(); } catch (Exception ignored) { }
        }
    }
}
