using RotaryApi.DTOs;
using RotaryApi.Services;
using Def = RotaryApi.Services.MemberFlexRules.FieldDef;

namespace RotaryApi.Tests;

public class MemberFlexTests
{
    private static readonly Dictionary<int, Def> Fields = new()
    {
        [1] = new Def(1, "text", Array.Empty<string>()),
        [2] = new Def(2, "number", Array.Empty<string>()),
        [3] = new Def(3, "date", Array.Empty<string>()),
        [4] = new Def(4, "choice", new[] { "Gold", "Silver" }),
        [5] = new Def(5, "yesno", Array.Empty<string>()),
    };
    private static readonly HashSet<int> Tags = new() { 10, 11 };
    private static readonly HashSet<int> Groups = new() { 20 };

    private static (string Sql, Dictionary<string, object?> Args) Compile(SmartListFilter f) => MemberFlexRules.Compile(f, Fields, Tags, Groups);

    [Fact]
    public void Empty_filter_adds_nothing()
    {
        var (sql, args) = Compile(new SmartListFilter());
        Assert.Equal("", sql);
        Assert.Empty(args);
    }

    [Fact]
    public void Values_are_parameters_never_sql_text()
    {
        const string evil = "x' OR 1=1; DROP TABLE club_members; --";
        var (sql, args) = Compile(new SmartListFilter
        {
            Search = evil,
            Fields = new() { new FieldCondition { FieldId = 1, Op = "contains", Value = evil }, new FieldCondition { FieldId = 1, Op = "eq", Value = evil } },
        });
        Assert.DoesNotContain("DROP", sql);
        Assert.DoesNotContain("'x", sql);
        Assert.Contains("@Search", sql);
        Assert.Contains("@V0", sql);
        Assert.Equal("%x' OR 1=1; DROP TABLE club\\_members; --%", args["V0"]);
        Assert.Equal(evil, args["V1"]);
    }

    [Fact]
    public void Tag_any_uses_one_in_list_and_all_uses_one_exists_per_tag()
    {
        var any = Compile(new SmartListFilter { TagIds = new() { 10, 11, 10 } });
        Assert.Contains("IN @Tags", any.Sql);
        Assert.Equal(new List<int> { 10, 11 }, any.Args["Tags"]);

        var all = Compile(new SmartListFilter { TagIds = new() { 10, 11 }, TagMode = "all" });
        Assert.Contains("@Tag0", all.Sql);
        Assert.Contains("@Tag1", all.Sql);
        Assert.Equal(2, all.Sql.Split("EXISTS").Length - 1);
    }

    [Theory]
    [InlineData(99, null, "tags")]       // a tag of another club
    [InlineData(null, 99, "committee")]  // a committee of another club
    public void Rejects_ids_that_are_not_the_clubs(int? tag, int? group, string what)
    {
        var f = new SmartListFilter { TagIds = tag is int t ? new() { t } : null, SubGroupIds = group is int g ? new() { g } : null };
        var ex = Assert.Throws<ArgumentException>(() => Compile(f));
        Assert.Contains(what == "tags" ? "tags" : "committees", ex.Message);
    }

    [Theory]
    [InlineData(1, "gt", "5")]        // gt is for numbers
    [InlineData(4, "contains", "Go")] // contains is for text
    [InlineData(3, "before", "19/11/2026")]
    [InlineData(2, "eq", "abc")]
    [InlineData(4, "eq", "Bronze")]
    [InlineData(7, "eq", "x")]        // deleted field
    [InlineData(1, "drop", "x")]
    public void Rejects_bad_conditions(int field, string op, string value)
        => Assert.Throws<ArgumentException>(() => Compile(new SmartListFilter { Fields = new() { new FieldCondition { FieldId = field, Op = op, Value = value } } }));

    [Fact]
    public void Number_and_date_conditions_compare_typed_values()
    {
        var (sql, args) = Compile(new SmartListFilter
        {
            JoinedFrom = "2020-07-01",
            MemberType = "honorary",
            SubGroupIds = new() { 20 },
            Fields = new()
            {
                new FieldCondition { FieldId = 2, Op = "gt", Value = "10.50" },
                new FieldCondition { FieldId = 3, Op = "before", Value = "2026-01-01" },
                new FieldCondition { FieldId = 5, Op = "eq", Value = "true" },
                new FieldCondition { FieldId = 4, Op = "notset" },
            },
        });
        Assert.Contains("CAST(v0.value AS DECIMAL(20,4)) > @V0", sql);
        Assert.Equal(10.5m, args["V0"]);
        Assert.Equal("2026-01-01", args["V1"]);
        Assert.Equal("yes", args["V2"]);
        Assert.Contains("AND NOT EXISTS (SELECT 1 FROM club_profile_values v3", sql);
        Assert.Contains("cm.IsHonoraryMember = 1", sql);
        Assert.Equal("2020-07-01", args["JoinedFrom"]);
        Assert.Contains("IN @SubGroups", sql);
    }

    [Theory]
    [InlineData("number", " 12.50 ", "12.5")]
    [InlineData("number", "-3", "-3")]
    [InlineData("date", "2026-02-03", "2026-02-03")]
    [InlineData("choice", "gold", "Gold")]
    [InlineData("yesno", "No", "no")]
    [InlineData("text", "  hi  ", "hi")]
    [InlineData("text", "   ", null)]
    public void Normalizes_values(string type, string raw, string? expected)
        => Assert.Equal(expected, MemberFlexRules.NormalizeValue(new Def(1, type, new[] { "Gold", "Silver" }), raw));

    [Fact]
    public void Validates_tags_and_fields()
    {
        Assert.Equal("#ABCDEF", MemberFlexRules.Color("#abcdef"));
        Assert.Throws<ArgumentException>(() => MemberFlexRules.Color("red"));
        Assert.Throws<ArgumentException>(() => MemberFlexRules.FieldType("html"));
        Assert.Throws<ArgumentException>(() => MemberFlexRules.Visibility("public"));
        Assert.Throws<ArgumentException>(() => MemberFlexRules.Options("choice", new() { "A", "a" }));
        Assert.Throws<ArgumentException>(() => MemberFlexRules.Options("choice", new()));
        Assert.Empty(MemberFlexRules.Options("text", new() { "ignored" }));
        Assert.Throws<ArgumentException>(() => MemberFlexRules.Name(new string('x', 51), 50, "Tag name"));
    }

    [Fact]
    public void Csv_cells_cannot_become_formulas()
    {
        Assert.Equal("\"'=SUM(A1)\"", MemberFlexRules.Csv("=SUM(A1)"));
        Assert.Equal("\"a \"\"b\"\"\"", MemberFlexRules.Csv("a \"b\""));
    }
}
