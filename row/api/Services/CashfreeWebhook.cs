using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RotaryApi.Services;

// A Cashfree webhook proves nothing by itself: anyone can post one. It only prompts us to ask Cashfree about the order.
public static class CashfreeWebhook
{
    /// <summary>The gateway could not be asked. The webhook answers with an error, so Cashfree sends it again.</summary>
    public sealed class LookupFailedException : Exception
    {
        public LookupFailedException(string message) : base(message) { }
    }

    /// <summary>
    /// Cashfree signs base64(HMAC-SHA256(timestamp + raw body)) with the client secret, with nothing between the two: that
    /// is its SDK (PGVerifyWebhookSignature) and its code samples; a "timestamp.payload" pseudo-code in its docs is wrong. Until
    /// Payments:Webhook:EnforceSignature is on, a bad signature is only logged: the check still has to be proven
    /// against real webhooks, which reach us through a relay outside this repo.
    /// </summary>
    public static void CheckSignature(IConfiguration config, ILogger logger, string rawBody, string? signature, string? timestamp)
    {
        var secret = config["CashfreePayment:ClientSecret"];
        if (!string.IsNullOrEmpty(secret) && !string.IsNullOrEmpty(signature) && !string.IsNullOrEmpty(timestamp))
        {
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
            var expected = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(timestamp + rawBody)));
            if (CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(signature))) return;
        }
        if (config.GetValue("Payments:Webhook:EnforceSignature", false))
            throw new UnauthorizedAccessException("Invalid webhook signature.");
        logger.LogWarning("Cashfree webhook signature missing or wrong (log-only, Payments:Webhook:EnforceSignature is off).");
    }

    /// <summary>
    /// Asks Cashfree about the order. True only when Cashfree itself reports this order as PAID, for this amount, in INR
    /// (every order is created in INR). Throws <see cref="LookupFailedException"/> when Cashfree could not answer.
    /// </summary>
    public static async Task<bool> OrderConfirmsAsync(IConfiguration config, HttpClient http, ILogger logger, string orderId, decimal amount)
    {
        var cf = config.GetSection("CashfreePayment");
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{cf["BaseUrl"]}orders/{Uri.EscapeDataString(orderId)}");
        request.Headers.Add("x-client-id", cf["ClientId"]);
        request.Headers.Add("x-client-secret", cf["ClientSecret"]);
        request.Headers.Add("x-api-version", cf["ApiVersion"]);

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        HttpResponseMessage response;
        string body;
        try
        {
            response = await http.SendAsync(request, timeout.Token);
            body = await response.Content.ReadAsStringAsync(timeout.Token);
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException)
        {
            throw new LookupFailedException($"Cashfree order lookup failed: {ex.GetType().Name}");
        }
        using (response)
        {
            if ((int)response.StatusCode >= 500 || (int)response.StatusCode is 401 or 403 or 429)
                throw new LookupFailedException($"Cashfree order lookup failed: HTTP {(int)response.StatusCode}");
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Cashfree webhook for order {OrderId}: Cashfree does not know this order (HTTP {Status}). Ignored.", orderId, (int)response.StatusCode);
                return false;
            }
        }

        JsonElement order;
        try { order = JsonSerializer.Deserialize<JsonElement>(body); }
        catch (JsonException) { throw new LookupFailedException("Cashfree order lookup failed: unreadable answer"); }

        var status = Text(order, "order_status");
        var echoedId = Text(order, "order_id");
        var currency = Text(order, "order_currency");
        var paidAmount = order.TryGetProperty("order_amount", out var a) && a.ValueKind == JsonValueKind.Number ? a.GetDecimal() : (decimal?)null;
        if (status == "PAID" && echoedId == orderId && currency == "INR" && paidAmount == amount) return true;

        logger.LogWarning("Cashfree webhook for order {OrderId} not honoured: Cashfree says status={Status}, order={EchoedId}, amount={Paid} {Currency}; our row is {Amount} INR.",
            orderId, status, echoedId, paidAmount, currency, amount);
        return false;
    }

    private static string? Text(JsonElement order, string name) =>
        order.ValueKind == JsonValueKind.Object && order.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
