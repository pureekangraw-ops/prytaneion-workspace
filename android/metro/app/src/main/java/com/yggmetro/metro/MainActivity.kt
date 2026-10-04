package com.yggmetro.metro

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.app.Activity

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar
    private lateinit var offlinePanel: LinearLayout

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(7, 11, 17)
        window.navigationBarColor = Color.rgb(5, 7, 10)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(5, 7, 10))
        }

        progress = ProgressBar(this).apply {
            isIndeterminate = true
            visibility = View.GONE
        }
        root.addView(progress, LinearLayout.LayoutParams(-1, 4))

        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(5, 7, 10))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.userAgentString = "${settings.userAgentString} YGG-METRO-Android/0.1.0"
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                    progress.visibility = View.VISIBLE
                    offlinePanel.visibility = View.GONE
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    progress.visibility = View.GONE
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?,
                ) {
                    if (request?.isForMainFrame == true) showOffline()
                }

                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    if (uri.scheme == "https") return false
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                        true
                    } catch (_: Exception) {
                        true
                    }
                }
            }
        }
        root.addView(webView, LinearLayout.LayoutParams(-1, 0, 1f))

        offlinePanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(40, 40, 40, 40)
            setBackgroundColor(Color.rgb(7, 11, 17))
            visibility = View.GONE
            addView(TextView(this@MainActivity).apply {
                text = "METRO ยังเชื่อมต่อไม่ได้"
                textColor = Color.WHITE
                textSize = 20f
                gravity = Gravity.CENTER
            })
            addView(TextView(this@MainActivity).apply {
                text = "ตรวจสอบอินเทอร์เน็ต แล้วลองใหม่อีกครั้ง"
                textColor = Color.LTGRAY
                textSize = 14f
                gravity = Gravity.CENTER
                setPadding(0, 12, 0, 20)
            })
            addView(Button(this@MainActivity).apply {
                text = "ลองใหม่"
                setOnClickListener { loadMetro() }
            })
        }
        root.addView(offlinePanel, LinearLayout.LayoutParams(-1, 0, 1f))

        setContentView(root)
        loadMetro()
    }

    @Deprecated("Use the system back dispatcher when the shell adopts AndroidX")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    private fun loadMetro() {
        offlinePanel.visibility = View.GONE
        webView.visibility = View.VISIBLE
        progress.visibility = View.VISIBLE
        webView.loadUrl(BuildConfig.METRO_URL)
    }

    private fun showOffline() {
        progress.visibility = View.GONE
        webView.visibility = View.GONE
        offlinePanel.visibility = View.VISIBLE
    }

    override fun onDestroy() {
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }
}
