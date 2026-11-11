package id.cava.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationParserTest {
    @Test fun parsesIndonesianThousandsSeparator() {
        val result = NotificationParser.parse("Pembayaran QRIS statis diterima", "Rp 25.000 di Warung")
        assertEquals(NotificationParseResult.Status.PAYMENT_INCOMING, result.status)
        assertEquals(25_000L, result.amount)
    }

    @Test fun parsesCurrencyWithDecimalSuffix() {
        val result = NotificationParser.parse("Pembayaran berhasil diterima", "Rp. 1.250.000,00")
        assertEquals(1_250_000L, result.amount)
    }

    @Test fun doesNotInventAmountWhenMissing() {
        val result = NotificationParser.parse("Pembayaran QRIS diterima", "Transaksi berhasil")
        assertEquals(NotificationParseResult.Status.AMOUNT_NOT_FOUND, result.status)
        assertNull(result.amount)
    }

    @Test fun ignoresRefundNotifications() {
        val result = NotificationParser.parse("Dana dikembalikan", "Refund Rp 25.000 berhasil")
        assertEquals(NotificationParseResult.Status.EXCLUDED, result.status)
        assertNull(result.amount)
    }

    @Test fun ignoresUnrelatedNotifications() {
        val result = NotificationParser.parse("Pesan baru", "Rp 25.000")
        assertEquals(NotificationParseResult.Status.NOT_INCOMING, result.status)
        assertNull(result.amount)
    }
}
