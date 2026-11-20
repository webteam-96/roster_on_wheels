using System.Net;
using System.Text.RegularExpressions;
using Dapper;
using RotaryApi.Services.Localization;

namespace RotaryApi.Services;

/// <summary>
/// Public help centre (competitor gap 2026-11-19): categories and articles written by Super Admin, read by anyone on
/// the ROW website, in the app and from the admin's contextual Help link. Article text is translated at read time by
/// the shared <see cref="LocalizationService"/> (translation memory, same 8 languages as the UI).
/// </summary>
public sealed class HelpCentreService
{
    public const int MaxBody = 200_000;
    private const int MaxTerms = 6;

    private readonly string _cs;
    private readonly LocalizationService _i18n;

    public HelpCentreService(IConfiguration cfg, LocalizationService i18n)
    {
        _cs = cfg.GetConnectionString("DefaultConnection")!;
        _i18n = i18n;
    }

    public record CategoryRow(int Id, string Slug, string Name, string? Description, int SortOrder, long Articles);
    public record ArticleListRow(int Id, string Slug, string Title, string? Summary, int CategoryId, string CategorySlug,
        string CategoryName, string Status, int SortOrder, string? ContextPath, int HelpfulYes, int HelpfulNo, DateTime UpdatedAt);
    public record ArticleRow(int Id, string Slug, string Title, string? Summary, string Body, string? Keywords, int CategoryId,
        string CategorySlug, string CategoryName, string Status, int SortOrder, string? ContextPath, int HelpfulYes,
        int HelpfulNo, DateTime UpdatedAt, DateTime? PublishedAt);
    public record RelatedCandidate(int Id, string Slug, string Title, string? Summary, int CategoryId, string? Keywords);
    public record ArticleInput(int CategoryId, string? Title, string? Slug, string? Summary, string? Body, string? Keywords,
        string? ContextPath, string? Status, int SortOrder);
    public record CategoryInput(string? Name, string? Slug, string? Description, int SortOrder);

    // ── Pure helpers (unit-tested) ───────────────────────────────────────────────────────────────────────────────

    private static readonly Regex SlugOk = new(@"^[a-z0-9]+(?:-[a-z0-9]+)*$", RegexOptions.Compiled);
    private static readonly Regex Tag = new(@"<[^>]*>", RegexOptions.Compiled);
    private static readonly Regex Space = new(@"\s+", RegexOptions.Compiled);
    private static readonly Regex BlockEnd = new(@"(?<=</(?:p|li|ul|ol|h[1-6]|blockquote|pre|div|table)>)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PathOk = new(@"^/[a-z0-9\-/\[\]]*$", RegexOptions.Compiled);

    public static string Slugify(string? text)
    {
        var s = Regex.Replace((text ?? "").ToLowerInvariant(), @"[^a-z0-9]+", "-").Trim('-');
        return s.Length > 120 ? s[..120].TrimEnd('-') : s;
    }

    public static bool ValidSlug(string? slug) => slug != null && slug.Length <= 120 && SlugOk.IsMatch(slug);

    /// <summary>Plain text of the article body, for search.</summary>
    public static string StripHtml(string? html) =>
        Space.Replace(WebUtility.HtmlDecode(Tag.Replace(html ?? "", " ")), " ").Trim();

    /// <summary>Escapes LIKE wildcards so a search for "100%" is literal.</summary>
    public static string LikeEscape(string term) => term.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_");

    public static List<string> SearchTerms(string? q) =>
        Space.Split((q ?? "").Trim()).Where(t => t.Length > 0).Select(t => t.Length > 40 ? t[..40] : t)
            .Distinct(StringComparer.OrdinalIgnoreCase).Take(MaxTerms).ToList();

    /// <summary>
    /// Splits HTML at block ends so each piece fits the translation provider's limit (5000 chars). Tags stay inside
    /// the pieces; the provider never sees them (LocalizationService masks markup). Joining the pieces gives the input back.
    /// </summary>
    public static List<string> SplitHtmlBlocks(string html, int max = 4000)
    {
        var parts = new List<string>();
        var current = "";
        foreach (var block in BlockEnd.Split(html))
        {
            if (current.Length > 0 && current.Length + block.Length > max) { parts.Add(current); current = ""; }
            current += block;
        }
        if (current.Length > 0) parts.Add(current);
        return parts;
    }

    public static IEnumerable<string> KeywordSet(string? keywords) =>
        (keywords ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(k => k.ToLowerInvariant());

    /// <summary>Related articles: shared keywords count twice, same category once; ties by title. Self excluded.</summary>
    public static List<RelatedCandidate> RankRelated(RelatedCandidate current, IEnumerable<RelatedCandidate> all, int take = 4)
    {
        var mine = KeywordSet(current.Keywords).ToHashSet();
        return all.Where(a => a.Id != current.Id)
            .Select(a => (a, score: KeywordSet(a.Keywords).Count(mine.Contains) * 2 + (a.CategoryId == current.CategoryId ? 1 : 0)))
            .Where(x => x.score > 0)
            .OrderByDescending(x => x.score).ThenBy(x => x.a.Title, StringComparer.OrdinalIgnoreCase)
            .Take(take).Select(x => x.a).ToList();
    }

    /// <summary>The article whose context path is the longest prefix of the admin page path (segment boundary).</summary>
    public static T? MatchContext<T>(string path, IEnumerable<(string ContextPath, T Article)> candidates) where T : class
    {
        path = path.TrimEnd('/');
        return candidates
            .Where(c => { var p = c.ContextPath.TrimEnd('/'); return p.Length > 0 && (path == p || path.StartsWith(p + "/", StringComparison.Ordinal)); })
            .OrderByDescending(c => c.ContextPath.TrimEnd('/').Length)
            .Select(c => c.Article).FirstOrDefault();
    }

    /// <summary>Server-side checks for an article. Returns the cleaned input, or an error message.</summary>
    public static (ArticleInput? Clean, string? Error) Validate(ArticleInput dto)
    {
        var title = dto.Title?.Trim() ?? "";
        if (title.Length is 0 or > 200) return (null, "Give a title (200 characters at most).");
        var slug = string.IsNullOrWhiteSpace(dto.Slug) ? Slugify(title) : dto.Slug.Trim().ToLowerInvariant();
        if (!ValidSlug(slug)) return (null, "The web address may use lowercase letters, numbers and single hyphens (120 at most).");
        var summary = dto.Summary?.Trim();
        if (summary?.Length > 400) return (null, "The summary is 400 characters at most.");
        var body = PublicHtml.Clean(dto.Body?.Trim()) ?? "";
        if (StripHtml(body).Length == 0) return (null, "Write the article text.");
        if (body.Length > MaxBody) return (null, "The article is too long.");
        var keywords = string.Join(", ", KeywordSet(dto.Keywords).Distinct());
        if (keywords.Length > 400) return (null, "Keywords are 400 characters at most.");
        var context = string.IsNullOrWhiteSpace(dto.ContextPath) ? null : dto.ContextPath.Trim().ToLowerInvariant().TrimEnd('/');
        if (context != null && (context.Length > 200 || !PathOk.IsMatch(context)))
            return (null, "The admin page path starts with / and uses letters, numbers, hyphens and slashes.");
        var status = dto.Status?.Trim().ToLowerInvariant() ?? "draft";
        if (status is not ("draft" or "published")) return (null, "Status is draft or published.");
        return (dto with { Title = title, Slug = slug, Summary = string.IsNullOrEmpty(summary) ? null : summary, Body = body,
            Keywords = keywords.Length == 0 ? null : keywords, ContextPath = context, Status = status }, null);
    }

    // ── Translation ──────────────────────────────────────────────────────────────────────────────────────────────

    private static bool English(string? lang) => string.IsNullOrWhiteSpace(lang) || lang.Split('-')[0].Equals("en", StringComparison.OrdinalIgnoreCase);

    /// <summary>Translates many short texts in one batch; same order. English or unsupported: unchanged.</summary>
    private async Task<string[]> Tr(string? lang, IReadOnlyList<string?> texts)
    {
        var src = texts.Select(t => t ?? "").ToList();
        if (English(lang) || !CommsTemplates.IsSupported(lang)) return src.ToArray();
        return await _i18n.TranslateAsync(lang!, src, signedIn: false);
    }

    // ── Public reads ─────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<object> PublicIndexAsync(string? lang, string? q, string? categorySlug)
    {
        await using var c = RowDb.Connect(_cs);
        var cats = (await c.QueryAsync<CategoryRow>(@"
            SELECT k.pk_category_id AS Id, k.slug AS Slug, k.name AS Name, k.description AS Description, k.sort_order AS SortOrder,
                   (SELECT COUNT(*) FROM help_articles a WHERE a.fk_category_id = k.pk_category_id AND a.status = 'published') AS Articles
            FROM help_categories k ORDER BY k.sort_order, k.name")).Where(k => k.Articles > 0).ToList();

        var terms = SearchTerms(q);
        var where = "a.status = 'published'";
        var args = new DynamicParameters();
        for (var i = 0; i < terms.Count; i++)
        {
            where += $" AND (a.title LIKE @t{i} OR a.summary LIKE @t{i} OR a.keywords LIKE @t{i} OR a.body_text LIKE @t{i})";
            args.Add($"t{i}", "%" + LikeEscape(terms[i]) + "%");
        }
        if (!string.IsNullOrWhiteSpace(categorySlug)) { where += " AND k.slug = @cat"; args.Add("cat", categorySlug.Trim()); }
        // Title hits first, then keywords, summary, body.
        var score = terms.Count == 0 ? "" : "(" + string.Join(" + ", terms.Select((_, i) =>
            $"(CASE WHEN a.title LIKE @t{i} THEN 8 WHEN a.keywords LIKE @t{i} THEN 4 WHEN a.summary LIKE @t{i} THEN 2 ELSE 1 END)")) + ") DESC,";
        var rows = (await c.QueryAsync<ArticleListRow>($@"
            SELECT a.pk_article_id AS Id, a.slug AS Slug, a.title AS Title, a.summary AS Summary, a.fk_category_id AS CategoryId,
                   k.slug AS CategorySlug, k.name AS CategoryName, a.status AS Status, a.sort_order AS SortOrder, a.context_path AS ContextPath,
                   a.helpful_yes AS HelpfulYes, a.helpful_no AS HelpfulNo, a.updated_at AS UpdatedAt
            FROM help_articles a JOIN help_categories k ON k.pk_category_id = a.fk_category_id
            WHERE {where}
            ORDER BY {score} k.sort_order, a.sort_order, a.title LIMIT 200", args)).ToList();

        var texts = cats.SelectMany(k => new[] { k.Name, k.Description }).Concat(rows.SelectMany(r => new[] { r.Title, r.Summary, r.CategoryName })).ToList();
        var t = await Tr(lang, texts);
        var n = 0;
        var categories = cats.Select(k => new { slug = k.Slug, name = t[n++], description = t[n++], articles = k.Articles }).ToList();
        var articles = rows.Select(r => new { slug = r.Slug, title = t[n++], summary = t[n++], category = t[n++], categorySlug = r.CategorySlug, updatedAt = r.UpdatedAt }).ToList();
        return new { categories, articles, query = q ?? "", category = categorySlug };
    }

    private const string ArticleSelect = @"
        SELECT a.pk_article_id AS Id, a.slug AS Slug, a.title AS Title, a.summary AS Summary, a.body AS Body, a.keywords AS Keywords,
               a.fk_category_id AS CategoryId, k.slug AS CategorySlug, k.name AS CategoryName, a.status AS Status, a.sort_order AS SortOrder,
               a.context_path AS ContextPath, a.helpful_yes AS HelpfulYes, a.helpful_no AS HelpfulNo, a.updated_at AS UpdatedAt,
               a.published_at AS PublishedAt
        FROM help_articles a JOIN help_categories k ON k.pk_category_id = a.fk_category_id";

    public async Task<object?> PublicArticleAsync(string slug, string? lang)
    {
        await using var c = RowDb.Connect(_cs);
        var a = await c.QueryFirstOrDefaultAsync<ArticleRow>(ArticleSelect + " WHERE a.slug = @slug AND a.status = 'published'", new { slug });
        if (a == null) return null;
        var all = await c.QueryAsync<RelatedCandidate>(@"SELECT pk_article_id AS Id, slug AS Slug, title AS Title, summary AS Summary,
            fk_category_id AS CategoryId, keywords AS Keywords FROM help_articles WHERE status = 'published'");
        var related = RankRelated(new RelatedCandidate(a.Id, a.Slug, a.Title, a.Summary, a.CategoryId, a.Keywords), all);

        var blocks = SplitHtmlBlocks(a.Body);
        var texts = new List<string?> { a.Title, a.Summary, a.CategoryName };
        texts.AddRange(blocks);
        texts.AddRange(related.Select(r => r.Title));
        var t = await Tr(lang, texts);
        // Translated text is the provider's output: clean it again before anyone renders it as HTML.
        var body = PublicHtml.Clean(string.Concat(t.Skip(3).Take(blocks.Count))) ?? "";
        return new
        {
            slug = a.Slug, title = t[0], summary = t[1], body,
            category = new { slug = a.CategorySlug, name = t[2] },
            updatedAt = a.UpdatedAt,
            related = related.Select((r, i) => new { slug = r.Slug, title = t[3 + blocks.Count + i] }),
        };
    }

    public async Task<bool> FeedbackAsync(string slug, bool helpful)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.ExecuteAsync(helpful
            ? "UPDATE help_articles SET helpful_yes = helpful_yes + 1 WHERE slug = @slug AND status = 'published'"
            : "UPDATE help_articles SET helpful_no = helpful_no + 1 WHERE slug = @slug AND status = 'published'", new { slug }) > 0;
    }

    public async Task<object?> ContextAsync(string path, string? lang)
    {
        await using var c = RowDb.Connect(_cs);
        var rows = await c.QueryAsync<(string ContextPath, string Slug, string Title)>(
            "SELECT context_path, slug, title FROM help_articles WHERE status = 'published' AND context_path IS NOT NULL");
        var hit = MatchContext(path.ToLowerInvariant(), rows.Select(r => (r.ContextPath, Article: new[] { r.Slug, r.Title })));
        if (hit == null) return null;
        var t = await Tr(lang, new[] { hit[1] });
        return new { slug = hit[0], title = t[0] };
    }

    // ── Super Admin ──────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<List<CategoryRow>> CategoriesAsync()
    {
        await using var c = RowDb.Connect(_cs);
        return (await c.QueryAsync<CategoryRow>(@"
            SELECT k.pk_category_id AS Id, k.slug AS Slug, k.name AS Name, k.description AS Description, k.sort_order AS SortOrder,
                   (SELECT COUNT(*) FROM help_articles a WHERE a.fk_category_id = k.pk_category_id) AS Articles
            FROM help_categories k ORDER BY k.sort_order, k.name")).ToList();
    }

    public static (CategoryInput? Clean, string? Error) Validate(CategoryInput dto)
    {
        var name = dto.Name?.Trim() ?? "";
        if (name.Length is 0 or > 120) return (null, "Give a category name (120 characters at most).");
        var slug = string.IsNullOrWhiteSpace(dto.Slug) ? Slugify(name) : dto.Slug.Trim().ToLowerInvariant();
        if (!ValidSlug(slug) || slug.Length > 80) return (null, "The web address may use lowercase letters, numbers and single hyphens (80 at most).");
        var desc = dto.Description?.Trim();
        if (desc?.Length > 300) return (null, "The description is 300 characters at most.");
        return (dto with { Name = name, Slug = slug, Description = string.IsNullOrEmpty(desc) ? null : desc }, null);
    }

    /// <summary>Insert (id null) or update. Null when the slug is taken.</summary>
    public async Task<int?> SaveCategoryAsync(int? id, CategoryInput d)
    {
        await using var c = RowDb.Connect(_cs);
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM help_categories WHERE slug = @Slug AND pk_category_id <> @id", new { d.Slug, id = id ?? 0 }) > 0) return null;
        if (id is int existing)
        {
            await c.ExecuteAsync(@"UPDATE help_categories SET name = @Name, slug = @Slug, description = @Description, sort_order = @SortOrder,
                updated_at = UTC_TIMESTAMP() WHERE pk_category_id = @existing", new { d.Name, d.Slug, d.Description, d.SortOrder, existing });
            return existing;
        }
        return await c.ExecuteScalarAsync<int>(@"INSERT INTO help_categories (name, slug, description, sort_order) VALUES (@Name, @Slug, @Description, @SortOrder);
            SELECT LAST_INSERT_ID();", d);
    }

    public async Task<bool> CategoryExistsAsync(int id)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM help_categories WHERE pk_category_id = @id", new { id }) > 0;
    }

    /// <summary>False when the category still has articles.</summary>
    public async Task<bool> DeleteCategoryAsync(int id)
    {
        await using var c = RowDb.Connect(_cs);
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM help_articles WHERE fk_category_id = @id", new { id }) > 0) return false;
        await c.ExecuteAsync("DELETE FROM help_categories WHERE pk_category_id = @id", new { id });
        return true;
    }

    public async Task<List<ArticleListRow>> ArticlesAsync(string? q, string? status)
    {
        await using var c = RowDb.Connect(_cs);
        var args = new DynamicParameters();
        var where = "1=1";
        if (status is "draft" or "published") { where += " AND a.status = @status"; args.Add("status", status); }
        var terms = SearchTerms(q);
        for (var i = 0; i < terms.Count; i++)
        {
            where += $" AND (a.title LIKE @t{i} OR a.slug LIKE @t{i} OR a.keywords LIKE @t{i})";
            args.Add($"t{i}", "%" + LikeEscape(terms[i]) + "%");
        }
        return (await c.QueryAsync<ArticleListRow>($@"
            SELECT a.pk_article_id AS Id, a.slug AS Slug, a.title AS Title, a.summary AS Summary, a.fk_category_id AS CategoryId,
                   k.slug AS CategorySlug, k.name AS CategoryName, a.status AS Status, a.sort_order AS SortOrder, a.context_path AS ContextPath,
                   a.helpful_yes AS HelpfulYes, a.helpful_no AS HelpfulNo, a.updated_at AS UpdatedAt
            FROM help_articles a JOIN help_categories k ON k.pk_category_id = a.fk_category_id
            WHERE {where} ORDER BY k.sort_order, a.sort_order, a.title", args)).ToList();
    }

    public async Task<ArticleRow?> ArticleAsync(int id)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.QueryFirstOrDefaultAsync<ArticleRow>(ArticleSelect + " WHERE a.pk_article_id = @id", new { id });
    }

    /// <summary>Insert (id null) or update. Null when the slug is taken.</summary>
    public async Task<int?> SaveArticleAsync(int? id, ArticleInput d, int memberId)
    {
        await using var c = RowDb.Connect(_cs);
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM help_articles WHERE slug = @Slug AND pk_article_id <> @id", new { d.Slug, id = id ?? 0 }) > 0) return null;
        var p = new
        {
            d.CategoryId, d.Title, d.Slug, d.Summary, d.Body, BodyText = StripHtml(d.Body), d.Keywords, d.ContextPath, d.Status,
            d.SortOrder, memberId, id = id ?? 0,
        };
        if (id != null)
        {
            await c.ExecuteAsync(@"UPDATE help_articles SET fk_category_id = @CategoryId, title = @Title, slug = @Slug, summary = @Summary,
                body = @Body, body_text = @BodyText, keywords = @Keywords, context_path = @ContextPath, sort_order = @SortOrder,
                published_at = CASE WHEN @Status = 'published' AND status <> 'published' THEN UTC_TIMESTAMP() ELSE published_at END,
                status = @Status, updated_by = @memberId, updated_at = UTC_TIMESTAMP() WHERE pk_article_id = @id", p);
            return id;
        }
        return await c.ExecuteScalarAsync<int>(@"INSERT INTO help_articles (fk_category_id, title, slug, summary, body, body_text, keywords,
                context_path, status, sort_order, created_by, updated_by, published_at)
            VALUES (@CategoryId, @Title, @Slug, @Summary, @Body, @BodyText, @Keywords, @ContextPath, @Status, @SortOrder, @memberId, @memberId,
                CASE WHEN @Status = 'published' THEN UTC_TIMESTAMP() ELSE NULL END);
            SELECT LAST_INSERT_ID();", p);
    }

    public async Task<bool> DeleteArticleAsync(int id)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.ExecuteAsync("DELETE FROM help_articles WHERE pk_article_id = @id", new { id }) > 0;
    }
}
