package com.baibiaowang.stockjudge;

import android.content.ContentValues;
import android.content.Context;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;
import android.util.Base64;
import android.provider.MediaStore;
import android.provider.DocumentsContract;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.BufferedInputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.charset.Charset;
import java.security.MessageDigest;
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

    private volatile boolean apkDownloading = false;
    private volatile boolean apkDownloadCancel = false;
    private Thread apkDownloadThread;
    private final Handler apkHandler = new Handler(Looper.getMainLooper());
    private String pendingInstallUri;

    private static final String FEED_FILE = "rss-feed.txt";
    private static final String FEED_PART = "rss-feed.txt.part";
    private static final String UPDATE_FILE = "rss-update.json";
    private static final String UPDATE_PART = "rss-update.json.part";
    private static final int RSS_CHUNK = 131072;
    private static final long MAX_TEXT_FILE_BYTES = 32L * 1024L * 1024L;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWebViewSystemInsets();
        installBackHandler();
        installNativeBridge();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (pendingInstallUri != null) {
            final String uri = pendingInstallUri;
            pendingInstallUri = null;
            apkHandler.postDelayed(new Runnable() {
                @Override public void run() { installDownloadedApk(uri); }
            }, 250L);
        }
    }

    /** Android 15+ edge-to-edge：把系统导航栏安全区同步给 WebView/CSS，避免固定底栏被系统三键/手势区域盖住。 */
    private void configureWebViewSystemInsets() {
        final WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
        if (wv == null) {
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override public void run() { configureWebViewSystemInsets(); }
            }, 250L);
            return;
        }
        ViewCompat.setOnApplyWindowInsetsListener(wv, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            String js = "document.documentElement.style.setProperty('--android-top-inset','" + bars.top + "px');" +
                        "document.documentElement.style.setProperty('--android-bottom-inset','" + bars.bottom + "px');";
            try { wv.evaluateJavascript(js, null); } catch (Exception ignored) { }
            return insets;
        });
        ViewCompat.requestApplyInsets(wv);
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
                runOnUiThread(new Runnable() {
                    @Override public void run() { saveExportFile(filename, content); }
                });
            }
            @JavascriptInterface public void fetchFeed(final String url) {
                new Thread(new Runnable() {
                    @Override public void run() { fetchFeedNative(url); }
                }).start();
            }
            @JavascriptInterface public String readFeedChunk(final int offset, final int maxLength) {
                return readFileChunkBase64(FEED_FILE, offset, maxLength, "RSS订阅");
            }
            @JavascriptInterface public void fetchUpdateManifest(final String url) {
                new Thread(new Runnable() {
                    @Override public void run() { fetchTextFileNative(url, UPDATE_FILE, UPDATE_PART, "更新清单", "window.__rssUpdateResult"); }
                }).start();
            }
            @JavascriptInterface public String readUpdateChunk(final int offset, final int maxLength) {
                return readFileChunkBase64(UPDATE_FILE, offset, maxLength, "更新清单");
            }
            @JavascriptInterface public void clearLocalFiles() {
                new Thread(new Runnable() {
                    @Override public void run() {
                        deletePrivateFile(FEED_FILE);
                        deletePrivateFile(FEED_PART);
                        deletePrivateFile(UPDATE_FILE);
                        deletePrivateFile(UPDATE_PART);
                        deleteCacheFile("zizhi-rss-update.apk");
                        deleteCacheFile("zizhi-rss-update.apk.part");
                    }
                }, "zizhi-rss-clear-local-files").start();
            }
            @JavascriptInterface public void downloadApk(final String url, final String filename, final String expectedSha256, final long expectedSize) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { startApkDownload(url, filename, expectedSha256, expectedSize); }
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
                            String scheme = u.getScheme();
                            if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return;
                            Intent i = new Intent(Intent.ACTION_VIEW, u);
                            startActivity(i);
                        } catch (Exception ignored) { }
                    }
                });
            }
        }, "AndroidNative");
    }

    private void deleteCacheFile(final String filename) {
        try {
            if (filename == null || filename.trim().isEmpty()) return;
            File file = new File(getCacheDir(), filename);
            if (file.exists()) file.delete();
        } catch (Exception ignored) { }
    }

    private void deletePrivateFile(final String filename) {
        try {
            if (filename == null || filename.trim().isEmpty()) return;
            File file = new File(getFilesDir(), filename);
            if (file.exists()) file.delete();
            if ("zizhi-rss-update.apk".equals(filename) || "zizhi-rss-update.apk.part".equals(filename)) {
                File cacheFile = new File(getCacheDir(), filename);
                if (cacheFile.exists()) cacheFile.delete();
            }
        } catch (Exception ignored) { }
    }

    private String readFileChunkBase64(final String filename, final int offset, final int maxLength, final String label) {
        int safeOffset = Math.max(0, offset);
        int safeLength = Math.max(1, Math.min(RSS_CHUNK, maxLength));
        File f = new File(getFilesDir(), filename);
        if (!f.exists() || safeOffset >= f.length()) return "";
        int n = (int)Math.min((long)safeLength, f.length() - safeOffset);
        byte[] buf = new byte[n];
        try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r")) {
            raf.seek(safeOffset);
            raf.readFully(buf);
            return Base64.encodeToString(buf, Base64.NO_WRAP);
        } catch (Exception e) {
            throw new RuntimeException("读取" + label + "失败：" + e.getMessage());
        }
    }

    private void fetchFeedNative(final String urlString) {
        fetchTextFileNative(urlString, FEED_FILE, FEED_PART, "数据源", "window.__rssNativeFeedResult");
    }

    private void fetchTextFileNative(final String urlString, final String outName, final String partName, final String label, final String callbackFn) {
        HttpURLConnection conn = null;
        File part = new File(getFilesDir(), partName);
        File out = new File(getFilesDir(), outName);
        try {
            if (urlString == null || !urlString.trim().startsWith("https://")) {
                throw new Exception("数据源必须使用 HTTPS");
            }

            String current = urlString.trim();
            for (int redirect = 0; redirect < 6; redirect++) {
                URL url = new URL(current);
                if (!"https".equalsIgnoreCase(url.getProtocol())) {
                    throw new Exception("重定向到了非 HTTPS 地址");
                }

                conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setRequestMethod("GET");
                conn.setRequestProperty("User-Agent", "ZizhiRSS-Updater/4.0.0");
                conn.setRequestProperty("Accept", "application/json,text/plain,application/rss+xml,application/atom+xml,application/feed+json,*/*");
                conn.setRequestProperty("Accept-Encoding", "identity");
                conn.setRequestProperty("Cache-Control", "no-cache");

                int code = conn.getResponseCode();
                if (code == HttpURLConnection.HTTP_MOVED_PERM
                        || code == HttpURLConnection.HTTP_MOVED_TEMP
                        || code == HttpURLConnection.HTTP_SEE_OTHER
                        || code == 307 || code == 308) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (location == null || location.trim().isEmpty()) {
                        throw new Exception("服务器重定向但未提供新地址");
                    }
                    URL next = new URL(new URL(current), location);
                    if (!"https".equalsIgnoreCase(next.getProtocol())) {
                        throw new Exception("服务器重定向到了非 HTTPS 地址");
                    }
                    current = next.toString();
                    continue;
                }

                if (code < 200 || code >= 300) {
                    throw new Exception("HTTP " + code);
                }

                long length = conn.getContentLengthLong();
                if (length > MAX_TEXT_FILE_BYTES) {
                    throw new Exception(label + "过大，超过 32 MB 限制");
                }

                Charset charset = resolveResponseCharset(conn.getContentType());
                boolean preserveBytes = StandardCharsets.UTF_8.equals(charset);
                long done = 0L;
                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     OutputStream outStream = new FileOutputStream(part, false)) {
                    if (StandardCharsets.UTF_8.equals(charset)) {
                        byte[] buf = new byte[32768];
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            done += n;
                            if (done > MAX_TEXT_FILE_BYTES) {
                                throw new Exception(label + "过大，超过 32 MB 限制");
                            }
                            outStream.write(buf, 0, n);
                        }
                    } else {
                        try (InputStreamReader reader = new InputStreamReader(in, charset);
                             OutputStreamWriter writer = new OutputStreamWriter(outStream, StandardCharsets.UTF_8)) {
                            char[] buf = new char[32768];
                            int n;
                            while ((n = reader.read(buf)) != -1) {
                                done += n;
                                if (done > MAX_TEXT_FILE_BYTES) {
                                    throw new Exception(label + "过大，超过 32 MB 限制");
                                }
                                writer.write(buf, 0, n);
                            }
                            writer.flush();
                        }
                    }
                    outStream.flush();
                }

                if (preserveBytes && length > 0 && done != length) {
                    throw new Exception(label + "读取长度异常：" + done + "/" + length);
                }
                if (!part.exists() || part.length() == 0) {
                    throw new Exception("服务器返回空文件");
                }

                if (out.exists() && !out.delete()) {
                    throw new Exception("无法替换旧数据文件");
                }
                if (!part.renameTo(out)) {
                    throw new Exception("无法保存数据文件");
                }

                conn.disconnect();
                conn = null;
                notifyJsTextResult(callbackFn, true, label + "读取成功");
                return;
            }
            throw new Exception("重定向次数过多");
        } catch (Exception e) {
            try { if (part.exists()) part.delete(); } catch (Exception ignored) { }
            notifyJsTextResult(callbackFn, false, label + "读取失败：" + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
    private static Charset resolveResponseCharset(final String contentType) {
        if (contentType == null) return StandardCharsets.UTF_8;
        try {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?i)\\bcharset\\s*=\\s*([^;]+)").matcher(contentType);
            if (m.find()) {
                String name = m.group(1).trim().replace("\"", "").replace("'", "");
                if (!name.isEmpty()) return Charset.forName(name);
            }
        } catch (Exception ignored) { }
        return StandardCharsets.UTF_8;
    }
    private void notifyJsTextResult(final String callbackFn, final boolean ok, final String message) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
                if (wv == null) return;
                String safeFn = (callbackFn == null || !callbackFn.matches("[A-Za-z0-9_.$]+"))
                        ? "window.__rssNativeTextResult" : callbackFn;
                String js = safeFn + "&&" + safeFn + "(" + (ok ? "true" : "false") + "," + jsStr(message) + ");";
                try { wv.evaluateJavascript(js, null); } catch (Exception ignored) { }
            }
        });
    }

    /**
     * APK 更新不再使用 Android 系统下载服务。
     *
     * 原 系统下载服务 对 GitHub Release/跨域重定向链并不稳定，设备端
     * 很容易出现“检测到更新，但没有真正开始下载”的情况。
     * 这里改为 App 内直接 HTTP(S) 下载到 cache：
     * 1) 手动跟随最多 5 次 HTTPS 302/301；
     * 2) 每次写入 .part 临时文件，完成后原子改名；
     * 3) 实时回传进度；
     * 4) 完成后通过 FileProvider 交给系统安装器。
     */
    private void startApkDownload(final String url, final String filename, final String expectedSha256, final long expectedSize) {
        if (apkDownloading) {
            notifyJsDownloadFailed("已有更新正在下载");
            return;
        }
        final String rawUrl = url == null ? "" : url.trim();
        if (!rawUrl.regionMatches(true, 0, "https://", 0, 8)) {
            notifyJsDownloadFailed("更新地址必须使用 HTTPS");
            return;
        }

        String safeNameValue = (filename == null || filename.trim().isEmpty())
            ? "zizhi-rss-update.apk" : filename.trim();
        if (!safeNameValue.toLowerCase().endsWith(".apk")) safeNameValue += ".apk";
        final String safeName = safeNameValue.replaceAll("[\\\\/:*?\"<>|]+", "_");

        final File partFile = new File(getCacheDir(), "zizhi-rss-update.apk.part");
        final File apkFile = new File(getCacheDir(), "zizhi-rss-update.apk");
        final String expectedDigest = expectedSha256 == null ? "" : expectedSha256.trim();
        if (!isTrustedUpdateUrl(rawUrl)) {
            notifyJsDownloadFailed("更新地址与官方发布路径不匹配");
            return;
        }
        if (!expectedDigest.matches("(?i)^[0-9a-f]{64}$")) {
            notifyJsDownloadFailed("更新清单缺少有效的 APK SHA-256");
            return;
        }
        if (expectedSize <= 1024L * 1024L) {
            notifyJsDownloadFailed("更新清单缺少有效的 APK 文件大小");
            return;
        }

        apkDownloading = true;
        apkDownloadCancel = false;
        apkDownloadThread = new Thread(new Runnable() {
            @Override public void run() {
                downloadApkNative(rawUrl, safeName, partFile, apkFile, expectedDigest, expectedSize);
            }
        }, "zizhi-rss-apk-download");
        apkDownloadThread.start();
    }

    private void downloadApkNative(final String startUrl, final String displayName,
                                    final File partFile, final File apkFile,
                                    final String expectedSha256, final long expectedSize) {
        HttpURLConnection conn = null;
        try {
            if (partFile.exists() && !partFile.delete()) {
                throw new Exception("无法清理旧下载文件");
            }

            String current = startUrl;
            long total = -1L;
            boolean initialRequest = true;

            for (int redirect = 0; redirect < 6; redirect++) {
                URL u = new URL(initialRequest ? appendCacheBuster(current) : current);
                if (!"https".equalsIgnoreCase(u.getProtocol())) {
                    throw new Exception("重定向到了非 HTTPS 地址");
                }

                conn = (HttpURLConnection) u.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(45000);
                conn.setRequestMethod("GET");
                conn.setRequestProperty("User-Agent", "ZizhiRSS-Updater/4.0");
                conn.setRequestProperty("Accept", "application/vnd.android.package-archive,application/octet-stream,*/*");
                conn.setRequestProperty("Accept-Encoding", "identity");
                conn.setRequestProperty("Cache-Control", "no-cache");

                int code = conn.getResponseCode();
                if (code == HttpURLConnection.HTTP_MOVED_PERM
                        || code == HttpURLConnection.HTTP_MOVED_TEMP
                        || code == HttpURLConnection.HTTP_SEE_OTHER
                        || code == 307 || code == 308) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (location == null || location.trim().isEmpty()) {
                        throw new Exception("服务器重定向但未提供新地址");
                    }
                    URL next = new URL(new URL(current), location);
                    if (!"https".equalsIgnoreCase(next.getProtocol())) {
                        throw new Exception("服务器重定向到了非 HTTPS 地址");
                    }
                    current = next.toString();
                    initialRequest = false;
                    continue;
                }

                if (code < 200 || code >= 300) {
                    throw new Exception("HTTP " + code);
                }

                total = conn.getContentLengthLong();
                if (total > 0 && expectedSize > 0 && total != expectedSize) {
                    conn.disconnect();
                    conn = null;
                    throw new Exception("下载大小与清单不符：" + total + "/" + expectedSize);
                }
                final long expected = total;
                notifyJsDownloadProgress(0, "running",
                        expected > 0 ? "开始下载 " + displayName : "开始下载…");

                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     OutputStream out = new FileOutputStream(partFile, false)) {
                    byte[] buf = new byte[32768];
                    long done = 0L;
                    int n;
                    int lastPct = -1;
                    long lastNotify = 0L;

                    while ((n = in.read(buf)) != -1) {
                        if (apkDownloadCancel) throw new InterruptedException("用户取消下载");
                        out.write(buf, 0, n);
                        done += n;

                        long now = SystemClock.uptimeMillis();
                        int pct = expected > 0
                            ? Math.max(0, Math.min(99, (int)Math.floor(done * 100d / expected)))
                            : 0;
                        if (pct != lastPct || now - lastNotify >= 300L) {
                            lastPct = pct;
                            lastNotify = now;
                            notifyJsDownloadProgress(pct, "running",
                                expected > 0 ? "正在下载 " + pct + "%" : "正在下载…");
                        }
                    }
                    out.flush();

                    if (expected > 0 && done != expected) {
                        throw new Exception("服务器返回长度异常：" + done + "/" + expected);
                    }
                    if (expectedSize > 0 && done != expectedSize) {
                        throw new Exception("下载大小与清单不符：" + done + "/" + expectedSize);
                    }
                    if (done < 1024L * 1024L) {
                        throw new Exception("下载文件过小，疑似不是 APK");
                    }
                }

                conn.disconnect();
                conn = null;

                if (!partFile.exists() || partFile.length() < 1024L * 1024L) {
                    throw new Exception("APK 临时文件无效");
                }
                if (expectedSize > 0 && partFile.length() != expectedSize) {
                    throw new Exception("临时文件大小与清单不符：" + partFile.length() + "/" + expectedSize);
                }

                if (expectedSha256 != null && !expectedSha256.isEmpty()) {
                    String actualSha256 = sha256Hex(partFile);
                    if (!actualSha256.equalsIgnoreCase(expectedSha256)) {
                        throw new Exception("APK 校验失败：SHA-256 不匹配");
                    }
                }

                // APK 是 ZIP 容器，正常文件应以 PK 开头。
                try (InputStream in = new java.io.FileInputStream(partFile)) {
                    int a = in.read();
                    int b = in.read();
                    if (a != 'P' || b != 'K') {
                        throw new Exception("服务器返回内容不是 APK");
                    }
                }

                if (apkFile.exists() && !apkFile.delete()) {
                    throw new Exception("无法替换旧安装包");
                }
                if (!partFile.renameTo(apkFile)) {
                    throw new Exception("无法保存安装包");
                }

                apkDownloading = false;
                notifyJsDownloadProgress(100, "complete", "下载完成");
                notifyJsDownloadComplete();

                final String installPath = apkFile.getAbsolutePath();
                apkHandler.postDelayed(new Runnable() {
                    @Override public void run() {
                        installDownloadedApk(installPath);
                    }
                }, 300L);
                return;
            }

            throw new Exception("重定向次数过多");
        } catch (InterruptedException e) {
            try { if (partFile.exists()) partFile.delete(); } catch (Exception ignored) { }
            apkDownloading = false;
            notifyJsDownloadFailed("更新下载已取消");
        } catch (Exception e) {
            try { if (partFile.exists()) partFile.delete(); } catch (Exception ignored) { }
            apkDownloading = false;
            notifyJsDownloadFailed("APK 下载失败：" + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
            apkDownloadThread = null;
            apkDownloading = false;
        }
    }

    private void notifyJsDownloadProgress(final int percent, final String status, final String message) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
                if (wv == null) return;
                String js = "window.__rssApkDownloadProgress&&window.__rssApkDownloadProgress(" +
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
                try { wv.evaluateJavascript("window.__rssApkDownloadComplete&&window.__rssApkDownloadComplete();", null); }
                catch (Exception ignored) { }
            }
        });
    }

    private void notifyJsDownloadFailed(final String message) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
                if (wv == null) return;
                String js = "window.__rssApkDownloadFailed&&window.__rssApkDownloadFailed(" + jsStr(message) + ");";
                try { wv.evaluateJavascript(js, null); } catch (Exception ignored) { }
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
            }
        });
    }

    private void installDownloadedApk(String localPath) {
        try {
            if (localPath == null || localPath.trim().isEmpty()) throw new Exception("安装文件地址为空");
            File apkFile = new File(localPath);
            if (!apkFile.exists() || apkFile.length() < 1024L * 1024L) {
                throw new Exception("安装文件不存在或文件不完整");
            }

            Uri uri = FileProvider.getUriForFile(
                MainActivity.this,
                getPackageName() + ".fileprovider",
                apkFile
            );

            if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                pendingInstallUri = localPath;
                notifyJsInstallNeedsPermission();
                try {
                    Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                    startActivity(settingsIntent);
                } catch (Exception ignored) { }
                return;
            }

            // 不同 Android / 厂商安装器对 content:// APK 的授权处理并不完全一致：
            // 同时设置 FLAG_GRANT_READ_URI_PERMISSION + ClipData，确保安装器真正拿到读取权限。
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            i.setClipData(ClipData.newRawUri("APK", uri));
            i.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
            try {
                startActivity(i);
            } catch (Exception first) {
                // 某些系统对 APK 安装更偏好 ACTION_INSTALL_PACKAGE，再尝试一次。
                Intent install = new Intent(Intent.ACTION_INSTALL_PACKAGE);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                install.setClipData(ClipData.newRawUri("APK", uri));
                install.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
                startActivity(install);
            }
        } catch (Exception e) {
            final String msg = "安装 APK 失败：" + e.getMessage();
            Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            notifyJsDownloadFailed(msg);
        }
    }

    private void notifyJsInstallNeedsPermission() {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                Toast.makeText(MainActivity.this, "请允许“自制RSS”安装未知应用，然后返回继续安装。", Toast.LENGTH_LONG).show();
            }
        });
    }

    @Override
    public void onDestroy() {
        apkDownloadCancel = true;
        if (apkDownloadThread != null) {
            try { apkDownloadThread.interrupt(); } catch (Exception ignored) { }
            apkDownloadThread = null;
        }
        super.onDestroy();
    }

    private void notifyJsSaveResult(final boolean ok, final String message) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
                if (wv == null) return;
                String js = "window.__rssSaveResult&&window.__rssSaveResult(" + (ok ? "true" : "false") + "," + jsStr(message) + ");";
                try { wv.evaluateJavascript(js, null); } catch (Exception ignored) { }
            }
        });
    }

    private void saveExportFile(final String filename, final String content) {
        Uri pendingUri = null;
        try {
            if (filename == null || filename.trim().isEmpty()) throw new Exception("文件名为空");
            if (content == null) throw new Exception("备份内容为空");
            if (content.length() > 64 * 1024 * 1024) throw new Exception("备份文件过大，超过 64 MB 限制");

            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/自制RSS");
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                pendingUri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (pendingUri == null) throw new Exception("无法创建下载文件");
                try (OutputStream out = getContentResolver().openOutputStream(pendingUri)) {
                    if (out == null) throw new Exception("无法打开下载文件");
                    out.write(content.getBytes(StandardCharsets.UTF_8));
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(pendingUri, values, null, null);
                notifyJsSaveResult(true, "已保存到 下载 / 自制RSS");
                return;
            }

            pendingExportName = filename;
            pendingExportText = content;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, filename);
            startActivityForResult(i, EXPORT_REQUEST);
        } catch (Exception e) {
            if (pendingUri != null) {
                try { getContentResolver().delete(pendingUri, null, null); } catch (Exception ignored) { }
            }
            final String msg = "导出失败：" + e.getMessage();
            notifyJsSaveResult(false, msg);
            Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == IMPORT_REQUEST) {
            if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
            final Uri uri = data.getData();
            new Thread(new Runnable() {
                @Override public void run() {
                    String text;
                    try (InputStream in = getContentResolver().openInputStream(uri)) {
                        if (in == null) throw new Exception("无法读取备份文件");
                        ByteArrayOutputStream bos = new ByteArrayOutputStream();
                        byte[] buf = new byte[16384];
                        int n;
                        long total = 0L;
                        while ((n = in.read(buf)) > 0) {
                            total += n;
                            if (total > 64L * 1024L * 1024L) {
                                throw new Exception("备份文件过大，超过 64 MB 限制");
                            }
                            bos.write(buf, 0, n);
                        }
                        if (total == 0L) throw new Exception("备份文件为空");
                        text = new String(bos.toByteArray(), StandardCharsets.UTF_8);
                    } catch (Exception e) {
                        final String msg = "恢复失败：" + e.getMessage();
                        runOnUiThread(new Runnable() {
                            @Override public void run() {
                                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
                            }
                        });
                        return;
                    }

                    final String payload = text;
                    runOnUiThread(new Runnable() {
                        @Override public void run() {
                            WebView wv = (getBridge() == null) ? null : getBridge().getWebView();
                            if (wv != null) {
                                wv.evaluateJavascript(
                                    "window.restoreBackupText && window.restoreBackupText(" + jsStr(payload) + ");",
                                    null
                                );
                            }
                        }
                    });
                }
            }, "zizhi-rss-import-backup").start();
            return;
        }

        if (requestCode == EXPORT_REQUEST) {
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                pendingExportName = null;
                pendingExportText = null;
                notifyJsSaveResult(false, "导出已取消");
                return;
            }
            try {
                if (pendingExportText == null) throw new Exception("待导出的备份内容为空");
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    if (out == null) throw new Exception("无法打开目标文件");
                    out.write(pendingExportText.getBytes(StandardCharsets.UTF_8));
                }
                notifyJsSaveResult(true, "导出成功");
                Toast.makeText(this, "导出成功", Toast.LENGTH_LONG).show();
            } catch (Exception e) {
                final String msg = "导出失败：" + e.getMessage();
                notifyJsSaveResult(false, msg);
                Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
            } finally {
                pendingExportName = null;
                pendingExportText = null;
            }
        }
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
    /**
     * ★ 2026-09-20 修：原实现只要 getWebView() 非 null 就注入。
     *   冷启动时 WebView 对象已经存在、但页面还没加载完，注入的变量会被
     *   随后的页面加载冲掉 —— 前端轮询 30 秒也拿不到，表现为
     *   「用其他应用打开 txt，什么都没发生」。
     *   热启动（App 已在前台，走 onNewIntent）时页面已就绪，所以只有冷启动坏，
     *   排查时极易误判成「intent-filter 没生效」。
     *   现在先问 document.readyState，只有 complete 才注入，否则每 500ms 重试。
     */
    private static String sha256Hex(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new java.io.FileInputStream(file))) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) != -1) digest.update(buf, 0, n);
        }
        byte[] hash = digest.digest();
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) sb.append(String.format("%02x", b & 0xff));
        return sb.toString();
    }

    /**
     * ★ 2026-09-20 新增：转义成 JS 双引号字符串字面量。
     *   原实现直接把路径拼进 `"...\" + path + "\"..."` ——
     *   路径里只要出现引号或反斜杠就会把注入的 JS 写成语法错误。
     *   （同一个「注入字符串不转义」的家族问题在 inject.mjs 里已经犯过一次，
     *   这次把原生侧也补上。）
     */
    private static boolean isTrustedUpdateUrl(final String value) {
        try {
            URL u = new URL(value);
            if (!"https".equalsIgnoreCase(u.getProtocol())) return false;
            String host = u.getHost();
            String path = u.getPath();
            if ("raw.githubusercontent.com".equalsIgnoreCase(host)) {
                return path.matches("/baibiaowang/GPT/apk/releases/[34]\\.\\d+\\.\\d+/app\\.apk");
            }
            if ("github.com".equalsIgnoreCase(host)) {
                return path.matches("/baibiaowang/GPT/releases/download/v[34]\\.\\d+\\.\\d+/zizhi-rss-[34]\\.\\d+\\.\\d+\\.apk");
            }
            return false;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String appendCacheBuster(String value) {
        long now = System.currentTimeMillis();
        if (value == null || value.trim().isEmpty()) return value;
        return value + (value.contains("?") ? "&" : "?") + "_zizhi_rss_cache=" + now;
    }

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
}
