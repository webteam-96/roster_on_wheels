using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

public sealed class PayLinkRequestDto
{
    public string? Kind { get; set; }
    public int Id { get; set; }
    public string? Email { get; set; }
}

[ApiController]
[Route("api/public/pay-link-request")]
public sealed class PublicPayLinkRequestController : ControllerBase
{
    private const string Answer = "If that address is on record for this payment, a new link is on its way. Please check your inbox.";

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<PublicPayLinkRequestController> _logger;

    public PublicPayLinkRequestController(IServiceScopeFactory scopes, ILogger<PublicPayLinkRequestController> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    // The same answer in the same time for every input: the lookup and the send both run after the reply, so neither the
    // text nor the delay says whether a member or a link exists.
    [EnableRateLimiting("pay-link-request")]
    [HttpPost]
    public ActionResult Request([FromBody] PayLinkRequestDto dto)
    {
        var email = dto.Email?.Trim();
        if (dto.Kind is "dues" or "event" && dto.Id > 0 && email is { Length: >= 3 and <= 254 } && email.Contains('@'))
        {
            var (kind, id) = (dto.Kind, dto.Id);
            // shortcut: a request in flight during an API restart is lost, the page lets the person ask again.
            _ = Task.Run(async () =>
            {
                try
                {
                    using var scope = _scopes.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<PayLinkRequestService>().RequestAsync(kind, id, email);
                }
                catch (Exception ex)
                {
                    _logger.LogError("Pay link request failed for {Kind} {Id}: {Error}", kind, id, ex.GetType().Name);
                }
            });
        }
        return Ok(new { message = Answer });
    }
}
