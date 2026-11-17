using Microsoft.Extensions.Logging;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class BackgroundWorkTests
{
    private sealed class CaptureLogger : ILogger
    {
        public readonly TaskCompletionSource<(LogLevel Level, Exception? Ex, string Message)> Logged = new();
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => Logged.TrySetResult((logLevel, exception, formatter(state, exception)));
    }

    [Fact]
    public async Task Run_LogsFailure_InsteadOfSwallowingIt()
    {
        var logger = new CaptureLogger();
        BackgroundWork.Logger = logger;

        BackgroundWork.Run("receipt email", () => throw new InvalidOperationException("smtp down"));

        var entry = await logger.Logged.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(LogLevel.Error, entry.Level);
        Assert.Equal("smtp down", entry.Ex?.Message);
        Assert.Contains("receipt email", entry.Message);
    }
}
