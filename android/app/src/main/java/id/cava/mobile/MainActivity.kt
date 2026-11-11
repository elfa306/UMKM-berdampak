package id.cava.mobile

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.DecimalFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : Activity() {
    private lateinit var content: FrameLayout
    private lateinit var webView: WebView
    private var webLoaded = false
    private val dark = Color.rgb(16, 60, 53)
    private val green = Color.rgb(22, 122, 104)
    private val pageBackground = Color.rgb(245, 248, 247)
    private val ink = Color.rgb(31, 47, 44)
    private val muted = Color.rgb(100, 117, 111)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = dark
        window.navigationBarColor = dark
        webView = createWebView()
        buildShell()
        showWeb()
    }

    private fun buildShell() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(pageBackground)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(10), dp(18), dp(10))
            setBackgroundColor(dark)
        }
        header.addView(TextView(this).apply {
            text = "CAVA"
            textSize = 22f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }, LinearLayout.LayoutParams(0, dp(42), 1f))
        header.addView(Button(this).apply {
            text = "Muat ulang"
            setTextColor(Color.WHITE)
            setOnClickListener { if (webView.url != null) webView.reload() else webView.loadUrl(BuildConfig.CAVA_WEB_URL) }
        })
        root.addView(header)

        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(10), dp(4), dp(10), dp(4))
        }
        tabs.addView(Button(this).apply {
            text = "CAVA"; isAllCaps = false; setOnClickListener { showWeb() }
        }, LinearLayout.LayoutParams(0, dp(46), 1f))
        tabs.addView(Button(this).apply {
            text = "Integrasi GoPay"; isAllCaps = false; setOnClickListener { showIntegration() }
        }, LinearLayout.LayoutParams(0, dp(46), 1f))
        root.addView(tabs)

        content = FrameLayout(this)
        root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(TextView(this).apply {
            text = "CAVA • Prototipe Android"
            textSize = 11f
            gravity = Gravity.CENTER
            setTextColor(muted)
            setPadding(dp(8), dp(7), dp(8), dp(7))
            setBackgroundColor(Color.WHITE)
        })
        setContentView(root)
    }

    private fun createWebView(): WebView = WebView(this).apply {
        setBackgroundColor(Color.WHITE)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.allowFileAccess = false
        settings.allowContentAccess = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (isTrustedCavaUrl(uri)) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                return true
            }
            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: android.webkit.WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) {
                    view.loadDataWithBaseURL(
                        null,
                        "<html><meta name='viewport' content='width=device-width, initial-scale=1'>" +
                            "<body style='font-family:sans-serif;padding:28px;color:#203b35;background:#f5f8f7'>" +
                            "<h2>Koneksi CAVA belum tersedia</h2><p>Periksa internet, lalu tekan Muat ulang.</p></body></html>",
                        "text/html", "UTF-8", null
                    )
                }
            }
            override fun onReceivedSslError(
                view: WebView,
                handler: android.webkit.SslErrorHandler,
                error: android.net.http.SslError
            ) { handler.cancel() }
        }
    }

    private fun isTrustedCavaUrl(uri: Uri): Boolean {
        if (uri.scheme != "https") return false
        val host = uri.host?.lowercase(Locale.ROOT) ?: return false
        val hosts = setOf(
            Uri.parse(BuildConfig.CAVA_WEB_URL).host?.lowercase(Locale.ROOT),
            "umkmberdampak.my.id", "www.umkmberdampak.my.id", "umkm-berdampak.vercel.app"
        ).filterNotNull()
        return host in hosts
    }

    private fun showWeb() {
        (webView.parent as? ViewGroup)?.removeView(webView)
        content.removeAllViews()
        content.addView(webView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ))
        if (!webLoaded) {
            webView.loadUrl(BuildConfig.CAVA_WEB_URL)
            webLoaded = true
        }
    }

    private fun showIntegration() {
        content.removeAllViews()
        val scroll = ScrollView(this)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(24))
        }
        scroll.addView(panel)
        content.addView(scroll)
        heading(panel, "Integrasi GoPay Merchant")
        paragraph(panel, "Prototipe ini menguji apakah notifikasi dari aplikasi yang dipilih dapat diterima dan nominalnya dapat dibaca.")

        val enabled = notificationAccessEnabled()
        card(panel, "Akses notifikasi", if (enabled) "Izin Notification Access sudah aktif." else "Izin belum aktif. Aktifkan secara manual melalui pengaturan Android.")
        action(panel, if (enabled) "Buka pengaturan izin" else "Aktifkan akses notifikasi") {
            runCatching { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        }
        paragraph(panel, "Sebelum aplikasi GoPay dipilih, CAVA hanya menyimpan nama paket aplikasi dan waktu notifikasi. Isi notifikasi tidak disimpan.")

        card(panel, "Pilih aplikasi GoPay Merchant", "Tampilkan notifikasi normal dari aplikasi di HP ini, segarkan daftar, lalu pilih aplikasi GoPay Merchant.")
        val selected = NotificationStore.targetPackage(this)
        paragraph(panel, if (selected == null) "Belum ada aplikasi yang dipilih." else "Aplikasi terpilih: $selected")

        val sources = NotificationStore.observedSources(this)
        if (sources.isEmpty()) paragraph(panel, "Belum ada sumber notifikasi terdeteksi.")
        sources.forEach { source ->
            val label = appLabel(source.packageName)
            panel.addView(Button(this).apply {
                text = "$label\n${source.packageName}"
                textSize = 12f
                isAllCaps = false
                setOnClickListener {
                    NotificationStore.setTargetPackage(this@MainActivity, source.packageName)
                    showIntegration()
                }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                .apply { bottomMargin = dp(6) })
        }

        action(panel, "Segarkan daftar") { showIntegration() }
        action(panel, "Hapus pilihan aplikasi") {
            NotificationStore.setTargetPackage(this, null)
            showIntegration()
        }
        action(panel, "Bersihkan daftar aplikasi") {
            NotificationStore.clearObservedSources(this)
            showIntegration()
        }

        card(panel, "Hasil pembacaan terakhir", "")
        val last = NotificationStore.lastCheck(this)
        if (last == null) {
            paragraph(panel, "Belum ada notifikasi dari aplikasi yang dipilih.")
        } else {
            paragraph(panel, "Sumber: ${last.packageName}")
            paragraph(panel, "Waktu: ${formatTime(last.checkedAt)}")
            val message = when (last.status) {
                NotificationParseResult.Status.PAYMENT_INCOMING -> "Nominal terdeteksi: ${formatRupiah(last.amount ?: 0L)}"
                NotificationParseResult.Status.AMOUNT_NOT_FOUND -> "Notifikasi diterima, tetapi nominal tidak ditemukan."
                NotificationParseResult.Status.EXCLUDED -> "Notifikasi diabaikan karena bukan pembayaran masuk."
                NotificationParseResult.Status.NOT_INCOMING -> "Notifikasi diterima, tetapi bukan pola pembayaran masuk."
            }
            paragraph(panel, message)
        }
        paragraph(panel, "Tahap ini belum mengirim data ke server atau mencatat transaksi. Hasil parsing hanya disimpan secara lokal.")
    }

    private fun notificationAccessEnabled(): Boolean {
        val component = ComponentName(this, NotificationCaptureService::class.java).flattenToString()
        val listeners = Settings.Secure.getString(contentResolver, "enabled_notification_listeners").orEmpty()
        return listeners.split(':').any { it.equals(component, ignoreCase = true) }
    }

    private fun appLabel(packageName: String): String = try {
        val info = packageManager.getApplicationInfo(packageName, 0)
        packageManager.getApplicationLabel(info).toString()
    } catch (_: Exception) { packageName }

    private fun heading(parent: LinearLayout, text: String) {
        parent.addView(TextView(this).apply {
            this.text = text; textSize = 19f; setTextColor(dark)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(0, dp(5), 0, dp(9))
        })
    }

    private fun paragraph(parent: LinearLayout, text: String) {
        parent.addView(TextView(this).apply {
            this.text = text; textSize = 14f; setTextColor(ink)
            setPadding(0, dp(3), 0, dp(7))
        })
    }

    private fun card(parent: LinearLayout, title: String, description: String) {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setBackgroundColor(Color.WHITE)
            elevation = dp(1).toFloat()
        }
        heading(container, title)
        if (description.isNotBlank()) paragraph(container, description)
        parent.addView(container, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(12) })
    }

    private fun action(parent: LinearLayout, label: String, run: () -> Unit) {
        parent.addView(Button(this).apply {
            text = label; isAllCaps = false; setTextColor(Color.WHITE)
            setBackgroundColor(green); setOnClickListener { run() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
            .apply { topMargin = dp(3); bottomMargin = dp(7) })
    }

    private fun formatRupiah(amount: Long): String =
        "Rp" + DecimalFormat("#,###").format(amount).replace(",", ".")
    private fun formatTime(timestamp: Long): String =
        SimpleDateFormat("dd MMM yyyy, HH:mm:ss", Locale("id", "ID")).format(Date(timestamp))
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    @Deprecated("Use system back navigation")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.parent != null && webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) { webView.stopLoading(); webView.destroy() }
        super.onDestroy()
    }
}
