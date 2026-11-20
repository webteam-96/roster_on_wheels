using RotaryApi.Services;
using Xunit;

namespace RotaryApi.Tests;

/// Enhanced committees: the subcommittee tree must never loop, and the message body must not carry markup.
public class CommitteeTreeTests
{
    // 1 > 2 > 3, 4 on its own
    private static readonly Dictionary<int, int?> Tree = new() { [1] = null, [2] = 1, [3] = 2, [4] = null };

    [Theory]
    [InlineData(4, 3)]     // under a grandchild of another branch
    [InlineData(3, 1)]     // move up the tree
    [InlineData(1, 4)]     // whole branch under another root
    [InlineData(2, null)]  // back to top level
    public void ValidMoves_AreAllowed(int id, int? parent) =>
        Assert.False(CommitteeTree.CreatesCycle(id, parent, Tree));

    [Theory]
    [InlineData(1, 1)]  // under itself
    [InlineData(1, 3)]  // under its own grandchild
    [InlineData(2, 3)]  // under its own child
    public void Loops_AreRefused(int id, int parent) =>
        Assert.True(CommitteeTree.CreatesCycle(id, parent, Tree));

    [Fact]
    public void ExistingLoopInData_IsTreatedAsLoop()
    {
        var broken = new Dictionary<int, int?> { [1] = 2, [2] = 1, [5] = null };
        Assert.True(CommitteeTree.CreatesCycle(5, 1, broken));
    }

    [Fact]
    public void PathTo_RunsFromTheTopDown_AndStopsAtLoops()
    {
        Assert.Equal(new[] { 1, 2, 3 }, CommitteeTree.PathTo(3, Tree));
        Assert.Equal(new[] { 4 }, CommitteeTree.PathTo(4, Tree));
        Assert.Equal(2, CommitteeTree.PathTo(1, new Dictionary<int, int?> { [1] = 2, [2] = 1 }).Count);
    }

    [Fact]
    public void MessageBody_IsEscapedAndKeepsLineBreaks() =>
        Assert.Equal("<p>a &lt;b&gt; &amp; c<br>next</p>", CommitteeService.ToHtml("a <b> & c\r\nnext"));
}
