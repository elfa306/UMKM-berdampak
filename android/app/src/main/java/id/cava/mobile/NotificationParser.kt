package id.cava.mobile

data class NotificationParseResult(val amount: Long?, val status: Status) {
    enum class Status { PAYMENT_INCOMING, AMOUNT_NOT_FOUND, NOT_INCOMING, EXCLUDED }
}

object NotificationParser {
    private val incomingPattern = Regex("(terima|diterima|masuk|berhasil)", RegexOption.IGNORE_CASE)
    private val excludedPattern = Regex("(tarik|penarikan|gagal|refund|dikembalikan|dibatalkan|promo|voucher)", RegexOption.IGNORE_CASE)
    private val rupiahPattern = Regex("""Rp\.?\s*([0-9][0-9.,]*)""", RegexOption.IGNORE_CASE)

    // Hanya menghasilkan nominal dan klasifikasi; teks asli tidak disimpan.
    fun parse(title: String?, body: String?): NotificationParseResult {
        val combined = listOfNotNull(title, body).map { it.trim() }
            .filter { it.isNotEmpty() }.joinToString(" ")
        if (combined.isBlank()) return NotificationParseResult(null, NotificationParseResult.Status.NOT_INCOMING)
        if (excludedPattern.containsMatchIn(combined)) return NotificationParseResult(null, NotificationParseResult.Status.EXCLUDED)
        if (!incomingPattern.containsMatchIn(combined)) return NotificationParseResult(null, NotificationParseResult.Status.NOT_INCOMING)

        val rawAmount = rupiahPattern.find(combined)?.groupValues?.getOrNull(1)
            ?: return NotificationParseResult(null, NotificationParseResult.Status.AMOUNT_NOT_FOUND)
        val withoutDecimal = rawAmount.replace(Regex("[.,]\\d{1,2}$"), "")
        val digitsOnly = withoutDecimal.replace(Regex("[^0-9]"), "")
        val amount = digitsOnly.toLongOrNull()?.takeIf { it > 0L }
        return if (amount != null) {
            NotificationParseResult(amount, NotificationParseResult.Status.PAYMENT_INCOMING)
        } else NotificationParseResult(null, NotificationParseResult.Status.AMOUNT_NOT_FOUND)
    }
}
