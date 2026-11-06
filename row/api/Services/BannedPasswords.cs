namespace RotaryApi.Services;

// The demo password is in this public repo's history and docs, so in Production it never works: not to sign in, even if it
// is an account's real password, and not as a new password. Such an account recovers through forgot-password.
public static class BannedPasswords
{
    public const string Message = "This password is not allowed. Please choose another.";

    private const string DemoPassword = "Admin@123";

    public static bool Refused(IHostEnvironment environment, string? password) =>
        environment.IsProduction() && string.Equals(password?.Trim(), DemoPassword, StringComparison.OrdinalIgnoreCase);
}
