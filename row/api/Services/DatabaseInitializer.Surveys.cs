using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Surveys and polls (gap #9, Services/SurveyService.cs). A club survey has fk_club_id (and optionally a sub group);
    /// a district survey has fk_district_id and no club. Open/close times are UTC. Additive only.
    /// </summary>
    private static async Task EnsureSurveyTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS surveys (
                pk_survey_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NULL,
                fk_district_id INT NULL,
                fk_sub_group_id INT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT NULL,
                is_anonymous TINYINT(1) NOT NULL DEFAULT 0,
                show_results TINYINT(1) NOT NULL DEFAULT 0,
                status VARCHAR(10) NOT NULL DEFAULT 'draft',
                opens_at DATETIME NOT NULL,
                closes_at DATETIME NOT NULL,
                published_at DATETIME NULL,
                created_by INT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                INDEX idx_survey_club (fk_club_id),
                INDEX idx_survey_district (fk_district_id),
                INDEX idx_survey_status_close (status, closes_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // options_json: the choices as a JSON array of strings; answers point at them by index, so questions are fixed
        // once the survey is published.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS survey_questions (
                pk_question_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_survey_id INT NOT NULL,
                sort_order INT NOT NULL,
                question_text VARCHAR(500) NOT NULL,
                question_type VARCHAR(10) NOT NULL,
                is_required TINYINT(1) NOT NULL DEFAULT 0,
                options_json TEXT NULL,
                INDEX idx_survey_question_survey (fk_survey_id),
                CONSTRAINT fk_survey_question_survey FOREIGN KEY (fk_survey_id) REFERENCES surveys (pk_survey_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // One response per member per survey (uk_survey_response_member); answering again replaces the answers.
        // fk_member_id is kept for anonymous surveys too (to enforce that), but the API never returns it for them.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS survey_responses (
                pk_response_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_survey_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                submitted_at DATETIME NOT NULL,
                updated_at DATETIME NULL,
                UNIQUE KEY uk_survey_response_member (fk_survey_id, fk_member_id),
                INDEX idx_survey_response_member (fk_member_id),
                CONSTRAINT fk_survey_response_survey FOREIGN KEY (fk_survey_id) REFERENCES surveys (pk_survey_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // choices: comma-separated option indexes (single / multiple choice).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS survey_answers (
                pk_answer_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_response_id INT NOT NULL,
                fk_question_id INT NOT NULL,
                choices VARCHAR(100) NULL,
                text_value TEXT NULL,
                rating TINYINT NULL,
                UNIQUE KEY uk_survey_answer (fk_response_id, fk_question_id),
                INDEX idx_survey_answer_question (fk_question_id),
                CONSTRAINT fk_survey_answer_response FOREIGN KEY (fk_response_id) REFERENCES survey_responses (pk_response_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // One in-app notification per audience member, written on publish; the app's bell shows it from notify_at
        // (the opening time) on.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS survey_notifications (
                pk_notification_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_survey_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                notify_at DATETIME NOT NULL,
                UNIQUE KEY uk_survey_notification (fk_survey_id, fk_member_id),
                INDEX idx_survey_notification_member (fk_member_id, notify_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
