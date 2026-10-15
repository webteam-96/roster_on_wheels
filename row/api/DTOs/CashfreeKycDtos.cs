namespace RotaryApi.DTOs;

public class CashfreeKycListDto
{
    public int Id { get; set; }
    public string VendorId { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string AccountHolder { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string Ifsc { get; set; } = "";
    public string Name { get; set; } = "";
    public string Pan { get; set; } = "";
    public string Status { get; set; } = "";
    public bool IsActive { get; set; }
    public DateTime? CreatedDate { get; set; }
}

public class CreateCashfreeKycDto
{
    public string VendorId { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string AccountHolder { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string Ifsc { get; set; } = "";
    public string Name { get; set; } = "";
    public string Pan { get; set; } = "";
}

public class UpdateCashfreeKycDto
{
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string AccountHolder { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string Ifsc { get; set; } = "";
    public string Name { get; set; } = "";
    public string Pan { get; set; } = "";
}

public class CashfreeOtpRequestDto
{
    public int? KycId { get; set; } // null for new, has value for edit
    public string VendorId { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string AccountHolder { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string Ifsc { get; set; } = "";
    public string Name { get; set; } = "";
    public string Pan { get; set; } = "";
}

public class CashfreeVerifyOtpDto
{
    public string Otp { get; set; } = "";
    public int? KycId { get; set; } // null for new, has value for edit
    public string VendorId { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string AccountHolder { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string Ifsc { get; set; } = "";
    public string Name { get; set; } = "";
    public string Pan { get; set; } = "";
}

public class CashfreeVendorDetailDto
{
    public int Id { get; set; }
    public string VendorId { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string AccountHolder { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string Ifsc { get; set; } = "";
    public string Name { get; set; } = "";
    public string Pan { get; set; } = "";
    public string Status { get; set; } = "";
    public string? CashfreeJson { get; set; }
}
