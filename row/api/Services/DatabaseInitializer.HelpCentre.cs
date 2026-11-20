using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Help centre (competitor gap 2026-11-19). CREATE TABLE IF NOT EXISTS only; the starter articles (HelpSeed) go in
// once, while both tables are empty. Undo: DROP TABLE help_articles, help_categories.
public partial class DatabaseInitializer
{
    private static async Task EnsureHelpCentreSchemaAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS help_categories (
                pk_category_id INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
                slug           VARCHAR(80)  NOT NULL,
                name           VARCHAR(120) NOT NULL,
                description    VARCHAR(300) NULL,
                sort_order     INT          NOT NULL DEFAULT 0,
                created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY ux_help_category_slug (slug)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS help_articles (
                pk_article_id  INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
                fk_category_id INT          NOT NULL,
                slug           VARCHAR(120) NOT NULL,
                title          VARCHAR(200) NOT NULL,
                summary        VARCHAR(400) NULL,
                body           MEDIUMTEXT   NOT NULL,              -- sanitized HTML (PublicHtml)
                body_text      MEDIUMTEXT   NOT NULL,              -- plain text of body, for search
                keywords       VARCHAR(400) NULL,                  -- comma-separated, lowercase
                context_path   VARCHAR(200) NULL,                  -- admin page path prefix for the contextual Help link
                status         VARCHAR(10)  NOT NULL DEFAULT 'draft', -- draft | published
                sort_order     INT          NOT NULL DEFAULT 0,
                helpful_yes    INT          NOT NULL DEFAULT 0,
                helpful_no     INT          NOT NULL DEFAULT 0,
                created_by     INT          NULL,
                updated_by     INT          NULL,
                created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                published_at   DATETIME     NULL,
                UNIQUE KEY ux_help_article_slug (slug),
                KEY ix_help_article_list (status, fk_category_id, sort_order),
                CONSTRAINT fk_help_article_category FOREIGN KEY (fk_category_id) REFERENCES help_categories (pk_category_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        if (await connection.ExecuteScalarAsync<int>("SELECT (SELECT COUNT(*) FROM help_categories) + (SELECT COUNT(*) FROM help_articles)") > 0) return;

        var ids = new Dictionary<string, int>();
        foreach (var k in HelpSeed.Categories)
            ids[k.Slug] = await connection.ExecuteScalarAsync<int>(@"
                INSERT INTO help_categories (slug, name, description, sort_order, created_at, updated_at)
                VALUES (@Slug, @Name, @Description, @Sort, UTC_TIMESTAMP(), UTC_TIMESTAMP()); SELECT LAST_INSERT_ID();", k);
        var sort = 0;
        foreach (var a in HelpSeed.Articles)
        {
            var body = PublicHtml.Clean(a.Body.Trim()) ?? "";
            await connection.ExecuteAsync(@"
                INSERT INTO help_articles (fk_category_id, slug, title, summary, body, body_text, keywords, context_path, status, sort_order,
                    created_at, updated_at, published_at)
                VALUES (@cat, @Slug, @Title, @Summary, @body, @text, @Keywords, @ContextPath, 'published', @sort,
                    UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())",
                new { cat = ids[a.Category], a.Slug, a.Title, a.Summary, body, text = HelpCentreService.StripHtml(body), a.Keywords, a.ContextPath, sort = ++sort });
        }
    }
}
