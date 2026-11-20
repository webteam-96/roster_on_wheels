using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// District speaker bureau (gap #13 part 2, 2026-11-19, Services/SpeakerBureauService.cs). Additive only. Dates
    /// and times are UTC (written with UTC_TIMESTAMP()). A talk is one club hosting the speaker on one date; a rating
    /// belongs to one talk, so a club rates a speaker once per talk date.
    /// </summary>
    private static async Task EnsureSpeakerBureauTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS speaker_bureau_entries (
                pk_entry_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_district_id INT NOT NULL,
                name VARCHAR(150) NOT NULL,
                bio VARCHAR(1500) NULL,
                topics VARCHAR(800) NOT NULL DEFAULT '',
                languages VARCHAR(300) NOT NULL DEFAULT '',
                email VARCHAR(254) NULL,
                phone VARCHAR(40) NULL,
                city VARCHAR(150) NULL,
                available_online TINYINT(1) NOT NULL DEFAULT 0,
                available_in_person TINYINT(1) NOT NULL DEFAULT 1,
                photo_path VARCHAR(300) NULL,
                fk_member_id INT NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'pending',
                fk_proposed_club_id INT NULL,
                fk_source_speaker_id INT NULL,
                created_by INT NOT NULL,
                created_date DATETIME NOT NULL,
                modified_by INT NULL,
                modified_date DATETIME NULL,
                reviewed_by INT NULL,
                reviewed_date DATETIME NULL,
                INDEX idx_bureau_district_status (fk_district_id, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // A talk is a club's booking of the speaker for a meeting date (source 'booked', future or past) or a talk found
        // in the club's meetings when it rates (source 'meeting'). fk_club_speaker_id: the club_speakers row the booking
        // put on the club's meeting schedule, removed again when the booking is cancelled.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS speaker_bureau_talks (
                pk_talk_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_entry_id INT NOT NULL,
                fk_club_id INT NOT NULL,
                talk_date DATE NOT NULL,
                source VARCHAR(10) NOT NULL,
                fk_club_speaker_id INT NULL,
                created_by INT NOT NULL,
                created_date DATETIME NOT NULL,
                UNIQUE KEY uk_bureau_talk (fk_entry_id, fk_club_id, talk_date),
                CONSTRAINT fk_bureau_talk_entry FOREIGN KEY (fk_entry_id) REFERENCES speaker_bureau_entries (pk_entry_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // One rating per talk (uk_bureau_rating_talk). comment_hidden: the district admin hid an abusive comment;
        // the score still counts.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS speaker_bureau_ratings (
                pk_rating_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_talk_id INT NOT NULL,
                rating TINYINT NOT NULL,
                comment VARCHAR(500) NULL,
                comment_hidden TINYINT(1) NOT NULL DEFAULT 0,
                hidden_by INT NULL,
                created_by INT NOT NULL,
                created_date DATETIME NOT NULL,
                UNIQUE KEY uk_bureau_rating_talk (fk_talk_id),
                CONSTRAINT fk_bureau_rating_talk FOREIGN KEY (fk_talk_id) REFERENCES speaker_bureau_talks (pk_talk_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
