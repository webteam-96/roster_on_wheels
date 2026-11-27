using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// New goal flow (RIZones 2026-11-17..23: District Set Goals, RCC Set Points, Disha Goals), ported 2026-11-27.
// Same tables as database/maintenance/2026-11-27-goal-flow.sql (production runs that script). New tables only, plus
// "For every" (per_unit) on District Awards auto questions and the fixed-id goal-figure activity rows.
// Disha tables are created empty; Disha Goals stay off (FeatureGate "disha_goals").
public partial class DatabaseInitializer
{
    internal static readonly string[] GoalFlowTables =
    {
        @"CREATE TABLE IF NOT EXISTS district_set_goal_targets (
            pk_id INT AUTO_INCREMENT PRIMARY KEY, fk_district_id INT NOT NULL, fk_year_id INT NOT NULL,
            line_type VARCHAR(12) NOT NULL, fk_line_id INT NOT NULL, fk_club_id INT NOT NULL DEFAULT 0, goal_value DECIMAL(14,2) NULL,
            created_by INT NULL, created_date DATETIME DEFAULT CURRENT_TIMESTAMP, modified_by INT NULL, modified_date DATETIME NULL,
            UNIQUE KEY uq_dsg_line_club (line_type, fk_line_id, fk_club_id), KEY ix_dsg_district_year (fk_district_id, fk_year_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS dsg_goal_lock (
            fk_year_id INT NOT NULL, fk_club_id INT NOT NULL, section_key VARCHAR(10) NOT NULL, is_locked TINYINT(1) NOT NULL DEFAULT 0,
            modified_by INT NULL, modified_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (fk_year_id, fk_club_id, section_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS dsg_rcc_points (
            fk_district_id INT NOT NULL, fk_year_id INT NOT NULL, item_no INT NOT NULL,
            points DECIMAL(12,2) NOT NULL DEFAULT 0, per_unit INT NOT NULL DEFAULT 1,
            is_bonus TINYINT(1) NOT NULL DEFAULT 0, bonus_points DECIMAL(12,2) NOT NULL DEFAULT 0,
            min_bonus INT NOT NULL DEFAULT 0, max_bonus INT NOT NULL DEFAULT 0, modified_by INT NULL, modified_date DATETIME NULL,
            PRIMARY KEY (fk_district_id, fk_year_id, item_no)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS goal_risao_links (
            pk_id INT AUTO_INCREMENT PRIMARY KEY, fk_district_id INT NOT NULL, fk_year_id INT NOT NULL,
            line_type VARCHAR(12) NOT NULL, fk_line_id INT NOT NULL, risao_key VARCHAR(40) NULL,
            created_by INT NULL, created_date DATETIME DEFAULT CURRENT_TIMESTAMP, modified_by INT NULL, modified_date DATETIME NULL,
            UNIQUE KEY uq_risao_line (line_type, fk_line_id), KEY ix_risao_district_year (fk_district_id, fk_year_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS disha_goal_questions (
            pk_id INT AUTO_INCREMENT PRIMARY KEY, fk_district_id INT NOT NULL, fk_year_id INT NOT NULL,
            category_name VARCHAR(150) NOT NULL, question_text VARCHAR(500) NOT NULL, source VARCHAR(10) NOT NULL DEFAULT 'manual',
            answer_type VARCHAR(20) NOT NULL DEFAULT 'number', options_json TEXT NULL, fk_activity_id INT NULL,
            sub_item_type VARCHAR(50) NULL, sub_item_id INT NULL, sub_item_name VARCHAR(255) NULL, filter_aof_id INT NULL, filter_cat_id INT NULL,
            goal_value DECIMAL(14,2) NULL, risao_key VARCHAR(40) NULL, sort_order INT NOT NULL DEFAULT 0, group_key VARCHAR(40) NULL,
            isdeleted TINYINT(1) NOT NULL DEFAULT 0, created_by INT NULL, created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            modified_by INT NULL, modified_date DATETIME NULL, KEY ix_disha_q_district_year (fk_district_id, fk_year_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS disha_goal_answers (
            pk_id INT AUTO_INCREMENT PRIMARY KEY, fk_question_id INT NOT NULL, fk_district_id INT NOT NULL, answer_value VARCHAR(2000) NULL,
            created_by INT NULL, created_date DATETIME DEFAULT CURRENT_TIMESTAMP, modified_by INT NULL, modified_date DATETIME NULL,
            UNIQUE KEY uq_disha_answer (fk_question_id, fk_district_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS disha_category (
            pk_id INT AUTO_INCREMENT PRIMARY KEY, fk_owner_id INT NOT NULL, fk_year_id INT NOT NULL,
            category_name VARCHAR(300) NOT NULL, sort_order INT DEFAULT 0, is_default TINYINT(1) DEFAULT 0,
            created_by INT NULL, created_date DATETIME DEFAULT CURRENT_TIMESTAMP, modified_by INT NULL, modified_date DATETIME NULL,
            isdeleted TINYINT(1) DEFAULT 0, KEY ix_disha_cat (fk_owner_id, fk_year_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS disha_auto_question (
            pk_id INT AUTO_INCREMENT PRIMARY KEY, fk_owner_id INT NOT NULL, fk_year_id INT NOT NULL, fk_category_id INT NOT NULL,
            fk_activity_id INT NOT NULL, points DECIMAL(10,2) DEFAULT 0, is_bonus TINYINT(1) DEFAULT 0, bonus_points DECIMAL(10,2) DEFAULT 0,
            min_bonus INT DEFAULT 0, max_bonus INT DEFAULT 0, per_unit INT NOT NULL DEFAULT 1, sort_order INT DEFAULT 0,
            created_by INT NULL, created_date DATETIME DEFAULT CURRENT_TIMESTAMP, modified_by INT NULL, modified_date DATETIME NULL,
            isdeleted TINYINT(1) DEFAULT 0, KEY ix_disha_aq (fk_owner_id, fk_year_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS disha_auto_question_sub (
            pk_id INT AUTO_INCREMENT PRIMARY KEY, fk_auto_question_id INT NOT NULL, sub_item_type VARCHAR(50) NULL, sub_item_id INT NULL,
            sub_item_name VARCHAR(300) NULL, filter_aof_id INT NULL, filter_cat_id INT NULL, points DECIMAL(10,2) DEFAULT 0,
            is_bonus TINYINT(1) DEFAULT 0, bonus_points DECIMAL(10,2) DEFAULT 0, min_bonus INT DEFAULT 0, max_bonus INT DEFAULT 0,
            sort_order INT DEFAULT 0, created_by INT NULL, created_date DATETIME DEFAULT CURRENT_TIMESTAMP, modified_by INT NULL,
            modified_date DATETIME NULL, isdeleted TINYINT(1) DEFAULT 0, KEY ix_disha_aqs (fk_auto_question_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS disha_manual_criteria (
            pk_id INT AUTO_INCREMENT PRIMARY KEY, fk_owner_id INT NOT NULL, fk_year_id INT NOT NULL, fk_category_id INT NOT NULL,
            criteria_name VARCHAR(500) NULL, sort_order INT DEFAULT 0,
            created_by INT NULL, created_date DATETIME DEFAULT CURRENT_TIMESTAMP, modified_by INT NULL, modified_date DATETIME NULL,
            isdeleted TINYINT(1) DEFAULT 0, KEY ix_disha_mc (fk_owner_id, fk_year_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS disha_manual_sub_criteria (
            pk_id INT AUTO_INCREMENT PRIMARY KEY, fk_criteria_id INT NOT NULL, sub_criteria_title VARCHAR(500) NULL,
            answer_type VARCHAR(20) NOT NULL DEFAULT 'number', points DECIMAL(10,2) DEFAULT 0, is_bonus TINYINT(1) DEFAULT 0,
            bonus_points DECIMAL(10,2) DEFAULT 0, min_bonus INT DEFAULT 0, max_bonus INT DEFAULT 0, remark TEXT NULL, sort_order INT DEFAULT 0,
            created_by INT NULL, created_date DATETIME DEFAULT CURRENT_TIMESTAMP, modified_by INT NULL, modified_date DATETIME NULL,
            isdeleted TINYINT(1) DEFAULT 0, KEY ix_disha_msc (fk_criteria_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS disha_manual_sub_criteria_option (
            pk_id INT AUTO_INCREMENT PRIMARY KEY, fk_sub_criteria_id INT NOT NULL, option_text VARCHAR(500) NOT NULL,
            option_points DECIMAL(10,2) DEFAULT 0, sort_order INT DEFAULT 0,
            created_by INT NULL, created_date DATETIME DEFAULT CURRENT_TIMESTAMP, modified_by INT NULL, modified_date DATETIME NULL,
            isdeleted TINYINT(1) DEFAULT 0, KEY ix_disha_opt (fk_sub_criteria_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS disha_district_entry (
            pk_id INT AUTO_INCREMENT PRIMARY KEY, fk_year_id INT NOT NULL, fk_district_id INT NOT NULL,
            entry_type VARCHAR(10) NOT NULL, fk_question_id INT NOT NULL, fk_sub_question_id INT NULL, answer_value VARCHAR(2000) NULL,
            points_earned DECIMAL(14,2) DEFAULT 0, bonus_earned DECIMAL(14,2) DEFAULT 0,
            created_by INT NULL, created_date DATETIME DEFAULT CURRENT_TIMESTAMP, modified_by INT NULL, modified_date DATETIME NULL,
            isdeleted TINYINT(1) DEFAULT 0, KEY ix_disha_entry (fk_district_id, fk_year_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS disha_goal (
            pk_id INT AUTO_INCREMENT PRIMARY KEY, fk_year_id INT NOT NULL, fk_district_id INT NOT NULL,
            line_type VARCHAR(12) NOT NULL, fk_line_id INT NOT NULL, goal_value DECIMAL(14,2) NULL,
            created_by INT NULL, created_date DATETIME DEFAULT CURRENT_TIMESTAMP, modified_by INT NULL, modified_date DATETIME NULL,
            UNIQUE KEY uq_disha_goal (line_type, fk_line_id, fk_district_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS disha_rcc_goal (
            fk_year_id INT NOT NULL, fk_district_id INT NOT NULL, field_key VARCHAR(80) NOT NULL, goal_value DECIMAL(14,2) NULL,
            modified_by INT NULL, modified_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (fk_year_id, fk_district_id, field_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        @"CREATE TABLE IF NOT EXISTS disha_goal_lock (
            fk_year_id INT NOT NULL, fk_district_id INT NOT NULL, section_key VARCHAR(10) NOT NULL, is_locked TINYINT(1) NOT NULL DEFAULT 0,
            modified_by INT NULL, modified_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (fk_year_id, fk_district_id, section_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    };

    internal static readonly (int Id, string Name)[] GoalFlowActivities =
    {
        (16, "Annual Fund"), (17, "PolioPlus Fund"), (18, "Endowment Fund"), (19, "Other Funds"), (20, "Annual Fund per capita"), (21, "Total Giving"), (22, "CSR with RFI"), (23, "New Clubs"),
    };

    /// <summary>Goal flow tables on every start, SkipInit or not (Program.cs): the District Set Goals pages answer 500
    /// without them, and production runs with Database:SkipInit. Idempotent.</summary>
    public async Task EnsureGoalFlowTablesAsync()
    {
        using var connection = RowDb.Connect(_connectionString);
        await connection.OpenAsync();
        await EnsureGoalFlowSchemaAsync(connection);
    }

    private static async Task EnsureGoalFlowSchemaAsync(MySqlConnection connection)
    {
        foreach (var ddl in GoalFlowTables) await connection.ExecuteAsync(ddl);
        await AddColumnIfNotExists(connection, "district_citation_auto_question", "per_unit", "INT NOT NULL DEFAULT 1 AFTER max_bonus");
        // Fixed ids (RisaoFigures / DishaGoalLinks read them); skipped when the id or the name is already taken.
        foreach (var (id, name) in GoalFlowActivities)
            await connection.ExecuteAsync(@"
                INSERT INTO district_citation_activity_master (pk_id, activity_name, sub_type, sort_order)
                SELECT @Id, @Name, 0, @Id FROM DUAL
                WHERE NOT EXISTS (SELECT 1 FROM district_citation_activity_master WHERE pk_id = @Id OR activity_name = @Name)",
                new { Id = id, Name = name });
    }
}
