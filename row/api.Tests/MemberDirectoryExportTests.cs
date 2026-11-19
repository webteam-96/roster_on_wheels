using ClosedXML.Excel;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Tests;

/// <summary>Club member directory export (Excel and PDF) built from the member list rows.</summary>
public class MemberDirectoryExportTests
{
    private static List<ClubMemberDto> Sample() =>
    [
        new() { Id = 2, MemberName = "zoe Adams", RotaryId = "0012345", PrimaryMobileNumber = "+44 7700 900123",
                EmailId = "zoe@example.org", Roles = ["Member", "President"], Designation = "President", MembershipActive = true,
                JoinedDate = new DateTime(2019, 7, 1) },
        new() { Id = 1, MemberName = "Arun Rao", ClassificationProfession = "Law", IsHonorary = true,
                MembershipActive = false, EmailId = null, PrimaryMobileNumber = null },
    ];

    [Fact]
    public void Rows_are_sorted_by_name_numbered_and_merge_roles_without_duplicates()
    {
        var rows = MemberDirectoryExportBuilder.Rows(Sample());

        Assert.Equal("Arun Rao", rows[0][1]);
        Assert.Equal("1", rows[0][0]);
        Assert.Equal("2", rows[1][0]);
        Assert.Equal("President", rows[1][4]);          // role and designation are the same: listed once
        Assert.Equal("", rows[0][5]);                   // hidden email stays blank
        Assert.Equal("1 Jul 2019", rows[1][7]);
        Assert.All(rows, r => Assert.Equal(MemberDirectoryExportBuilder.Columns.Length, r.Length));
    }

    [Fact]
    public void Excel_keeps_leading_zeros_and_plus_signs_as_text()
    {
        var bytes = MemberDirectoryExportBuilder.BuildExcel("Test Club", Sample());

        using var wb = new XLWorkbook(new MemoryStream(bytes));
        var ws = wb.Worksheet(1);
        Assert.Equal("Test Club", ws.Cell(1, 1).GetString());
        Assert.Equal("0012345", ws.Cell(6, 3).GetString());     // header on row 4, Zoe second on row 6
        Assert.Equal("+44 7700 900123", ws.Cell(6, 7).GetString());
        Assert.Equal(XLDataType.Text, ws.Cell(6, 3).DataType);
    }

    [Fact]
    public void Pdf_is_a_pdf_even_for_an_empty_club()
    {
        var bytes = MemberDirectoryExportBuilder.BuildPdf("Empty Club", []);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
    }
}
