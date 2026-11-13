namespace RotaryApi.Services.Assistant.Tools;

// Every tool the assistant's models may call. Adding a tool here changes the cached prompt prefix,
// so bump AssistantPrompts.Version at the same time.
public static class AssistantToolCatalog
{
    public static IEnumerable<AssistantTool> All() =>
        CoreTools.All()
            .Concat(PeopleTools.All())
            .Concat(ProjectCommsTools.All())
            .Concat(FinanceGoalTools.All());
}
