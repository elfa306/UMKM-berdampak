package id.cava.mobile

import android.app.Notification
import android.content.ComponentName
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class NotificationCaptureService : NotificationListenerService() {
    override fun onListenerConnected() {
        super.onListenerConnected()
        // Stored as a diagnostic hint; Android can reconnect this service independently.
    }

    override fun onListenerDisconnected() {
        requestRebind(ComponentName(this, NotificationCaptureService::class.java))
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val sourcePackage = sbn.packageName
        if (sourcePackage == packageName || sourcePackage.startsWith("android.") ||
            sourcePackage == "android" || sourcePackage == "com.android.systemui"
        ) return

        // Before target selection, only package name and timestamp are retained.
        NotificationStore.recordObservedSource(this, sourcePackage, sbn.postTime)

        val targetPackage = NotificationStore.targetPackage(this) ?: return
        if (sourcePackage != targetPackage) return

        val extras = sbn.notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val body = listOf(
            extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
            extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
            extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString(),
            extras.getCharSequence(Notification.EXTRA_INFO_TEXT)?.toString()
        ).filterNotNull().map { it.trim() }.filter { it.isNotEmpty() }.distinct().joinToString(" ")

        // Notification text is processed in memory and is never persisted by this prototype.
        val result = NotificationParser.parse(title, body)
        NotificationStore.recordCheck(this, sourcePackage, sbn.postTime, result)
    }
}
