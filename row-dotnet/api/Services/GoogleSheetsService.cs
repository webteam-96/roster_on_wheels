using Google.Apis.Auth.OAuth2;
using Google.Apis.Auth.OAuth2.Flows;
using Google.Apis.Auth.OAuth2.Responses;
using Google.Apis.Drive.v3;
using Google.Apis.Drive.v3.Data;
using Google.Apis.Services;
using Google.Apis.Sheets.v4;
using Google.Apis.Sheets.v4.Data;

namespace RotaryApi.Services;

public interface IGoogleSheetsService
{
    Task<string> CreateSpreadsheetAsync(string title, string[]? headers = null);
    Task AppendRowAsync(string spreadsheetId, IList<object> values);
    // Replaces every data row (everything below the frozen header) with `rows` in one shot —
    // for features reporting a live, per-entity snapshot (e.g. one row per club) rather than
    // an append-only payment log, where a row's values change over time instead of only growing.
    Task WriteRowsAsync(string spreadsheetId, IList<IList<object>> rows);
    // Rewrites row 1 (values + header formatting) to match `headers` exactly — including
    // shrinking when the new header set is shorter than whatever was there before (e.g. a
    // campaign's offline columns being removed). Used when a sheet's column shape can change
    // after creation (a campaign toggling offline payments on/off), unlike WriteRowsAsync which
    // only ever touches data rows.
    Task SetHeadersAsync(string spreadsheetId, string[] headers);
    Task RenameSpreadsheetAsync(string spreadsheetId, string newTitle);
    Task ShareWithEmailAsync(string spreadsheetId, string email);
    Task DeleteSpreadsheetAsync(string spreadsheetId);
}

public class GoogleSheetsService : IGoogleSheetsService
{
    private readonly IConfiguration _config;
    private readonly ILogger<GoogleSheetsService> _logger;

    private static readonly string[] DefaultHeaders = new[]
    {
        "Sr.No", "Member Name", "District", "Club", "Mobile", "Email",
        "Registration Type", "Amount", "Payment Date", "Paid Source",
        "Partner Name", "T-Shirt", "Food", "Remark1", "Remark2", "Remark3", "Designation"
    };

    public GoogleSheetsService(IConfiguration config, ILogger<GoogleSheetsService> logger)
    {
        _config = config;
        _logger = logger;
    }

    private UserCredential GetCredential()
    {
        var google = _config.GetSection("Google");
        var clientId = google["ClientId"]!;
        var clientSecret = google["ClientSecret"]!;
        var refreshToken = google["RefreshToken"]!;

        var tokenResponse = new TokenResponse { RefreshToken = refreshToken };
        var credential = new UserCredential(
            new GoogleAuthorizationCodeFlow(new GoogleAuthorizationCodeFlow.Initializer
            {
                ClientSecrets = new ClientSecrets { ClientId = clientId, ClientSecret = clientSecret }
            }),
            "user",
            tokenResponse
        );
        return credential;
    }

    public async Task<string> CreateSpreadsheetAsync(string title, string[]? headers = null)
    {
        var credential = GetCredential();
        var sheetsService = new SheetsService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = "ROW"
        });

        headers ??= DefaultHeaders;

        // Create spreadsheet
        var spreadsheet = new Spreadsheet
        {
            Properties = new SpreadsheetProperties { Title = title },
            Sheets = new List<Sheet>
            {
                new Sheet
                {
                    Properties = new SheetProperties
                    {
                        Title = "Sheet1",
                        GridProperties = new GridProperties { FrozenRowCount = 1 }
                    }
                }
            }
        };

        var created = await sheetsService.Spreadsheets.Create(spreadsheet).ExecuteAsync();
        var spreadsheetId = created.SpreadsheetId;
        var sheetId = created.Sheets[0].Properties.SheetId!.Value;

        await WriteHeaderRowAsync(sheetsService, spreadsheetId, sheetId, headers);

        _logger.LogInformation("Created Google Sheet {SpreadsheetId} with title {Title}", spreadsheetId, title);
        return spreadsheetId;
    }

    // Row 1 only: values + blue/bold/bordered header formatting. Shared by CreateSpreadsheetAsync
    // (new sheet) and SetHeadersAsync (existing sheet whose column shape changed) so the two can
    // never visually drift apart.
    private static async Task WriteHeaderRowAsync(SheetsService sheetsService, string spreadsheetId, int sheetId, string[] headers)
    {
        // Clear the full row first — SetHeadersAsync can shrink the header set (e.g. a campaign's
        // offline columns going away), and a plain Update only overwrites cells it has values for,
        // leaving old header text/formatting stranded past the new last column.
        await sheetsService.Spreadsheets.Values.Clear(new ClearValuesRequest(), spreadsheetId, "Sheet1!A1:Z1").ExecuteAsync();

        var headerValues = new List<IList<object>> { headers.Cast<object>().ToList() };
        var valueRange = new ValueRange { Values = headerValues };
        var updateRequest = sheetsService.Spreadsheets.Values.Update(valueRange, spreadsheetId, "Sheet1!A1");
        updateRequest.ValueInputOption = SpreadsheetsResource.ValuesResource.UpdateRequest.ValueInputOptionEnum.RAW;
        await updateRequest.ExecuteAsync();

        var thinBorder = new Border
        {
            Style = "SOLID",
            Color = new Color { Red = 0.7f, Green = 0.7f, Blue = 0.7f, Alpha = 1 }
        };
        var allBorders = new Borders
        {
            Top = thinBorder, Bottom = thinBorder, Left = thinBorder, Right = thinBorder
        };
        const int maxFormattedCols = 26; // A:Z — clears stale blue formatting from a previously wider header

        var requests = new List<Request>
        {
            // Reset any previously-formatted columns beyond the new header count back to default,
            // THEN (below) apply the blue header format to exactly the current headers — handles
            // both growing and shrinking the column set.
            new Request
            {
                RepeatCell = new RepeatCellRequest
                {
                    Range = new GridRange { SheetId = sheetId, StartRowIndex = 0, EndRowIndex = 1, StartColumnIndex = 0, EndColumnIndex = maxFormattedCols },
                    Cell = new CellData { UserEnteredFormat = new CellFormat() },
                    Fields = "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)"
                }
            },
            // Header row only: blue background, white bold text, borders
            new Request
            {
                RepeatCell = new RepeatCellRequest
                {
                    Range = new GridRange
                    {
                        SheetId = sheetId,
                        StartRowIndex = 0,
                        EndRowIndex = 1,
                        StartColumnIndex = 0,
                        EndColumnIndex = headers.Length
                    },
                    Cell = new CellData
                    {
                        UserEnteredFormat = new CellFormat
                        {
                            BackgroundColor = new Color
                            {
                                Red = 0x17 / 255f,
                                Green = 0x45 / 255f,
                                Blue = 0x8F / 255f,
                                Alpha = 1
                            },
                            TextFormat = new TextFormat
                            {
                                Bold = true,
                                FontSize = 11,
                                ForegroundColor = new Color { Red = 1, Green = 1, Blue = 1, Alpha = 1 }
                            },
                            HorizontalAlignment = "CENTER",
                            VerticalAlignment = "MIDDLE",
                            Borders = allBorders
                        }
                    },
                    Fields = "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)"
                }
            },
            // Auto-resize columns to fit header content
            new Request
            {
                AutoResizeDimensions = new AutoResizeDimensionsRequest
                {
                    Dimensions = new DimensionRange
                    {
                        SheetId = sheetId,
                        Dimension = "COLUMNS",
                        StartIndex = 0,
                        EndIndex = headers.Length
                    }
                }
            }
        };

        var batchUpdate = new BatchUpdateSpreadsheetRequest { Requests = requests };
        await sheetsService.Spreadsheets.BatchUpdate(batchUpdate, spreadsheetId).ExecuteAsync();
    }

    public async Task SetHeadersAsync(string spreadsheetId, string[] headers)
    {
        var credential = GetCredential();
        var sheetsService = new SheetsService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = "ROW"
        });

        var spreadsheet = await sheetsService.Spreadsheets.Get(spreadsheetId).ExecuteAsync();
        var sheetId = spreadsheet.Sheets[0].Properties.SheetId!.Value;
        await WriteHeaderRowAsync(sheetsService, spreadsheetId, sheetId, headers);
    }

    public async Task RenameSpreadsheetAsync(string spreadsheetId, string newTitle)
    {
        var credential = GetCredential();
        var driveService = new DriveService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = "ROW"
        });

        var update = new Google.Apis.Drive.v3.Data.File { Name = newTitle };
        var request = driveService.Files.Update(update, spreadsheetId);
        request.Fields = "id, name";
        await request.ExecuteAsync();
        _logger.LogInformation("Renamed Google Sheet {SpreadsheetId} to {Title}", spreadsheetId, newTitle);
    }

    public async Task AppendRowAsync(string spreadsheetId, IList<object> values)
    {
        var credential = GetCredential();
        var sheetsService = new SheetsService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = "ROW"
        });

        var valueRange = new ValueRange { Values = new List<IList<object>> { values } };
        var request = sheetsService.Spreadsheets.Values.Append(valueRange, spreadsheetId, "Sheet1!A:Q");
        request.ValueInputOption = SpreadsheetsResource.ValuesResource.AppendRequest.ValueInputOptionEnum.USERENTERED;
        request.InsertDataOption = SpreadsheetsResource.ValuesResource.AppendRequest.InsertDataOptionEnum.INSERTROWS;
        await request.ExecuteAsync();
    }

    public async Task WriteRowsAsync(string spreadsheetId, IList<IList<object>> rows)
    {
        var credential = GetCredential();
        var sheetsService = new SheetsService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = "ROW"
        });

        // Clear first so a snapshot that shrank (e.g. clubs removed) doesn't leave stale rows
        // dangling past the new last row — Update alone only overwrites cells it has values for.
        await sheetsService.Spreadsheets.Values.Clear(new ClearValuesRequest(), spreadsheetId, "Sheet1!A2:Z100000").ExecuteAsync();

        if (rows.Count > 0)
        {
            var valueRange = new ValueRange { Values = rows };
            var request = sheetsService.Spreadsheets.Values.Update(valueRange, spreadsheetId, "Sheet1!A2");
            request.ValueInputOption = SpreadsheetsResource.ValuesResource.UpdateRequest.ValueInputOptionEnum.USERENTERED;
            await request.ExecuteAsync();
        }
    }

    public async Task ShareWithEmailAsync(string spreadsheetId, string email)
    {
        var credential = GetCredential();
        var driveService = new DriveService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = "ROW"
        });

        var permission = new Permission
        {
            Type = "user",
            Role = "writer",
            EmailAddress = email
        };

        var request = driveService.Permissions.Create(permission, spreadsheetId);
        request.SendNotificationEmail = false;
        await request.ExecuteAsync();

        _logger.LogInformation("Shared Google Sheet {SpreadsheetId} with {Email}", spreadsheetId, email);
    }

    public async Task DeleteSpreadsheetAsync(string spreadsheetId)
    {
        var credential = GetCredential();
        var driveService = new DriveService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = "ROW"
        });

        await driveService.Files.Delete(spreadsheetId).ExecuteAsync();
        _logger.LogInformation("Deleted Google Sheet {SpreadsheetId} from Drive", spreadsheetId);
    }
}
