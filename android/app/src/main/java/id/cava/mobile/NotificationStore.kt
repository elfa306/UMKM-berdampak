package id.cava.mobile

import android.content.Context

data class ObservedNotificationSource(val packageName: String, val lastSeenAt: Long)
data class LastNotificationCheck(
    val packageName: String,
    val checkedAt: Long,
    val amount: Long?,
    val status: NotificationParseResult.Status
)

object NotificationStore {
    private const val PREFS = "cava_notification_prototype"
    private const val SOURCE_PREFIX = "source:"
    private const val KEY_TARGET_PACKAGE = "target_package"
    private const val KEY_LAST_PACKAGE = "last_package"
    private const val KEY_LAST_AT = "last_at"
    private const val KEY_LAST_AMOUNT = "last_amount"
    private const val KEY_LAST_STATUS = "last_status"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun recordObservedSource(context: Context, packageName: String, timestamp: Long) {
        if (packageName.isNotBlank()) prefs(context).edit().putLong(SOURCE_PREFIX + packageName, timestamp).apply()
    }

    fun observedSources(context: Context): List<ObservedNotificationSource> =
        prefs(context).all.filterKeys { it.startsWith(SOURCE_PREFIX) }.mapNotNull { (key, value) ->
            val timestamp = value as? Long ?: return@mapNotNull null
            ObservedNotificationSource(key.removePrefix(SOURCE_PREFIX), timestamp)
        }.sortedByDescending { it.lastSeenAt }.take(30)

    fun clearObservedSources(context: Context) {
        val editor = prefs(context).edit()
        prefs(context).all.keys.filter { it.startsWith(SOURCE_PREFIX) }.forEach(editor::remove)
        editor.apply()
    }

    fun setTargetPackage(context: Context, packageName: String?) {
        prefs(context).edit().putString(KEY_TARGET_PACKAGE, packageName)
            .remove(KEY_LAST_PACKAGE).remove(KEY_LAST_AT).remove(KEY_LAST_AMOUNT).remove(KEY_LAST_STATUS).apply()
    }

    fun targetPackage(context: Context): String? = prefs(context).getString(KEY_TARGET_PACKAGE, null)

    fun recordCheck(context: Context, packageName: String, timestamp: Long, result: NotificationParseResult) {
        prefs(context).edit().putString(KEY_LAST_PACKAGE, packageName)
            .putLong(KEY_LAST_AT, timestamp).putLong(KEY_LAST_AMOUNT, result.amount ?: -1L)
            .putString(KEY_LAST_STATUS, result.status.name).apply()
    }

    fun lastCheck(context: Context): LastNotificationCheck? {
        val values = prefs(context)
        val name = values.getString(KEY_LAST_STATUS, null) ?: return null
        val status = runCatching { NotificationParseResult.Status.valueOf(name) }.getOrNull() ?: return null
        return LastNotificationCheck(
            values.getString(KEY_LAST_PACKAGE, "").orEmpty(),
            values.getLong(KEY_LAST_AT, 0L),
            values.getLong(KEY_LAST_AMOUNT, -1L).takeIf { it > 0L },
            status
        )
    }
}
