/// Static select options used by member-edit forms. Mirrors
/// `rotary-frontend/src/lib/constants.ts` so the mobile and web admin
/// surfaces share the same option lists.
class FormConstants {
  static const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  static const genders = ['Male', 'Female', 'Other'];
  // The eight launch languages, as on the web (admin/src/lib/constants.ts LANGUAGES).
  static const languages = [
    'English', 'French', 'German', 'Italian', 'Japanese', 'Korean', 'Portuguese', 'Spanish', 'Other',
  ];
  static const relations = [
    'Brother',
    'Daughter',
    'Daughter-in-law',
    'Father',
    'Granddaughter',
    'Grandson',
    'Mother',
    'Sister',
    'Sister-in-law',
    'Son',
    'Son-in-law',
    'Spouse',
  ];
  static const indianStates = [
    'Maharashtra',
    'Gujarat',
    'Karnataka',
    'Tamil Nadu',
    'Rajasthan',
    'Delhi',
    'Uttar Pradesh',
    'West Bengal',
    'Kerala',
    'Madhya Pradesh',
    'Telangana',
    'Andhra Pradesh',
    'Punjab',
    'Haryana',
    'Bihar',
    'Other',
  ];
}
