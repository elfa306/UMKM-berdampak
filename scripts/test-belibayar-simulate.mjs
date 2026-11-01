
import crypto from "node:crypto";

const apiKey = process.env.BELIBAYAR_SANDBOX_API_KEY;
const secret = process.env.BELIBAYAR_SANDBOX_SECRET_KEY;
const baseUrl =
  process.env.BELIBAYAR_API_BASE_URL || "https://api.belibayar.id";

const reference = process.argv[2];
const action = process.argv[3] || "success";

if (!apiKey || !secret || !reference) {
  console.error("API Key, Secret Key, atau reference belum tersedia.");
  process.exit(1);
}

if (!["success", "expire"].includes(action)) {
  console.error("Action harus success atau expire.");
  process.exit(1);
}

const body = JSON.stringify({ reference, action });

const signature = crypto
  .createHmac("sha256", secret)
  .update(body)
  .digest("hex");

try {
  const response = await fetch(
    `${baseUrl}/direct/v1/sandbox/payment/simulate`,
    {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "X-Signature": signature,
        "Content-Type": "application/json",
      },
      body,
    }
  );

  const result = await response.json();

  console.log("HTTP Status:", response.status);
  console.log("Reference:", reference);
  console.log("Simulation Result:", JSON.stringify(result, null, 2));
} catch (error) {
  console.error("Request failed:", error.message);
  process.exit(1);
}
