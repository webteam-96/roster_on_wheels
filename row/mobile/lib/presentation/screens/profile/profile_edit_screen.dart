import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/constants/form_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../data/models/member_model.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/aspect_ratio_network_image.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/day_month_picker.dart';
import '../share_contact/share_contact_sheet.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/form_action_bar.dart';
import 'package:rotary_flutter_app/presentation/widgets/common/custom_button.dart';

/// Member-edit screen with full parity to the web `MemberForm`. Five tabs:
/// Personal · Social · Residential · Business · Family.
class ProfileEditScreen extends StatefulWidget {
  const ProfileEditScreen({super.key});

  @override
  State<ProfileEditScreen> createState() => _ProfileEditScreenState();
}

class _Country {
  final int id;
  final String name;
  final String? phoneCode;
  const _Country({required this.id, required this.name, this.phoneCode});
  factory _Country.fromJson(Map<String, dynamic> j) => _Country(
        id: (j['id'] as int?) ?? 0,
        name: (j['countryName'] ?? j['name'] ?? '').toString(),
        phoneCode:
            (j['phoneCode'] ?? j['countryPhoneCode'])?.toString(),
      );
}

class _ProfileEditScreenState extends State<ProfileEditScreen>
    with SingleTickerProviderStateMixin {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  late final TabController _tab = TabController(length: 5, vsync: this);

  // ── Personal ────────────────────────────────────────────────────────────
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _mobile = TextEditingController();
  final _altMobile = TextEditingController();
  final _rotaryId = TextEditingController();
  final _donorRecognition = TextEditingController();
  final _intro = TextEditingController();
  String? _gender;
  String? _bloodGroup;
  String? _language;
  DateTime? _birthDate;
  DateTime? _anniversaryDate;
  int? _primaryCountryId;
  int? _secondaryCountryId;
  bool _personalVisible = true;
  bool _isHonorary = false;
  bool _isYouth = false;
  String? _profilePhotoPath;
  bool _uploadingProfile = false;

  // ── Social ──────────────────────────────────────────────────────────────
  final _facebook = TextEditingController();
  final _instagram = TextEditingController();
  final _linkedIn = TextEditingController();
  final _twitter = TextEditingController();
  final _youtube = TextEditingController();
  final _website = TextEditingController();

  // ── Residential / Business ──────────────────────────────────────────────
  MemberAddressModel _residential =
      const MemberAddressModel(addressType: 'Residential');
  MemberAddressModel _business =
      const MemberAddressModel(addressType: 'Business');

  // ── Family ──────────────────────────────────────────────────────────────
  bool _familyVisible = true;
  String? _familyPhotoPath;
  bool _uploadingFamily = false;
  // Per-row upload state for individual family-member photos (by list index).
  final Set<int> _uploadingMemberPhoto = {};
  List<FamilyMemberModel> _familyMembers = [];

  // ── State ───────────────────────────────────────────────────────────────
  MemberModel? _original;
  bool _loading = true;
  bool _saving = false;
  String? _error;
  List<_Country> _countries = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _tab.dispose();
    for (final c in [
      _name,
      _email,
      _mobile,
      _altMobile,
      _rotaryId,
      _donorRecognition,
      _intro,
      _facebook,
      _instagram,
      _linkedIn,
      _twitter,
      _youtube,
      _website,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final memberId = context.read<AuthProvider>().memberId;
    try {
      final results = await Future.wait([
        _api.get<Map<String, dynamic>>('/api/members/$memberId',
            fromJson: (j) => j as Map<String, dynamic>),
        _api.get<List<dynamic>>('/api/countries',
            fromJson: (j) => j as List<dynamic>),
      ]);
      if (!mounted) return;
      final memberJson = results[0].data as Map<String, dynamic>?;
      final countriesRaw = results[1].data as List<dynamic>?;
      _countries = (countriesRaw ?? const [])
          .map((e) => _Country.fromJson(e as Map<String, dynamic>))
          .where((c) => c.id != 0 && c.name.isNotEmpty)
          .toList();
      if (memberJson != null) {
        final m = MemberModel.fromJson(memberJson);
        _original = m;
        _name.text = m.memberName;
        _email.text = m.emailId ?? '';
        _mobile.text = m.primaryMobileNumber ?? '';
        _altMobile.text = m.secondaryMobileNumber ?? '';
        _rotaryId.text = m.rotaryId ?? '';
        _donorRecognition.text = m.donorRecognition ?? '';
        _intro.text = m.memberIntroduction ?? '';
        _gender = FormConstants.genders.contains(m.gender) ? m.gender : null;
        _bloodGroup = FormConstants.bloodGroups.contains(m.bloodGroup)
            ? m.bloodGroup
            : null;
        _language = FormConstants.languages.contains(m.primaryLanguage)
            ? m.primaryLanguage
            : null;
        _birthDate = _parseDate(m.birthDate);
        _anniversaryDate = _parseDate(m.anniversaryDate);
        _primaryCountryId = m.fkPrimaryCountryId;
        _secondaryCountryId = m.fkSecondaryCountryId;
        _personalVisible = m.isPersonalDetailsVisible;
        _familyVisible = m.isFamilyDetailsVisible;
        _isHonorary = m.isHonoraryMember;
        _isYouth = m.isYouth;
        _profilePhotoPath = m.profilePhotoPath;
        _familyPhotoPath = m.familyPhotoPath;
        _facebook.text = m.facebook ?? '';
        _instagram.text = m.instagram ?? '';
        _linkedIn.text = m.linkedIn ?? '';
        _twitter.text = m.twitter ?? '';
        _youtube.text = m.youtube ?? '';
        _website.text = m.website ?? '';
        _residential = m.addresses.firstWhere(
          (a) => a.addressType == 'Residential',
          orElse: () => const MemberAddressModel(addressType: 'Residential'),
        );
        _business = m.addresses.firstWhere(
          (a) => a.addressType == 'Business',
          orElse: () => const MemberAddressModel(addressType: 'Business'),
        );
        // Designation/Classification now arrive top-level (club_members), not
        // inside the Business address. Seed the Business-tab fields so they
        // prefill; saved back at the top level in _save().
        _business = _business.copyWith(
          designation: m.designation,
          classificationProfession: m.classificationProfession,
        );
        _familyMembers = List<FamilyMemberModel>.from(m.familyMembers);
      }
      // Pre-select India anywhere a country is still unset; never overwrites a
      // country the member already had.
      _applyCountryDefaults();
      setState(() => _loading = false);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  DateTime? _parseDate(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      final d = DateTime.parse(raw);
      // Backend zero dates (`0001-01-01`) mean "no value" — keep the field empty.
      return d.year <= 1 ? null : d;
    } catch (_) {
      return null;
    }
  }

  String _formatForApi(DateTime dt) =>
      '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}T00:00:00';

  // Birthday/anniversary are day-month only (the year is a 1900 placeholder
  // system-wide), so render without the year to avoid showing "1900".
  String _formatDisplay(DateTime? dt) {
    if (dt == null || dt.year <= 1) return ''; // `0001-01-01` zero date => no value
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    return '${dt.day} ${months[dt.month - 1]}';
  }

  // The only dates edited here are birthday/anniversary (member + family), all
  // day-month only — use the day-month picker, not a full year-bearing calendar.
  Future<DateTime?> _pickDate(DateTime? initial) async {
    return showDayMonthPicker(context, initial: initial);
  }

  Future<void> _pickPhoto({required bool isFamily}) async {
    try {
      final picker = ImagePicker();
      final picked =
          await picker.pickImage(source: ImageSource.gallery, maxWidth: 1200);
      if (picked == null) return;

      // Let the user crop before uploading. The profile photo is shown as a
      // circular avatar, so lock it to a square (1:1); the family photo crops
      // free-form. Returning null means the user cancelled the crop.
      final cropped = await ImageCropper().cropImage(
        sourcePath: picked.path,
        aspectRatio: isFamily ? null : const CropAspectRatio(ratioX: 1, ratioY: 1),
        compressQuality: 90,
        uiSettings: [
          AndroidUiSettings(
            toolbarTitle: isFamily ? 'Crop Photo' : 'Crop Profile Photo',
            toolbarColor: AppColors.primary,
            toolbarWidgetColor: Colors.white,
            activeControlsWidgetColor: AppColors.primary,
            lockAspectRatio: !isFamily,
            initAspectRatio: isFamily
                ? CropAspectRatioPreset.original
                : CropAspectRatioPreset.square,
            aspectRatioPresets: isFamily
                ? const [
                    CropAspectRatioPreset.original,
                    CropAspectRatioPreset.square,
                    CropAspectRatioPreset.ratio4x3,
                    CropAspectRatioPreset.ratio16x9,
                  ]
                : const [CropAspectRatioPreset.square],
          ),
          IOSUiSettings(
            title: isFamily ? 'Crop Photo' : 'Crop Profile Photo',
            aspectRatioLockEnabled: !isFamily,
            resetAspectRatioEnabled: isFamily,
            aspectRatioPresets: isFamily
                ? const [
                    CropAspectRatioPreset.original,
                    CropAspectRatioPreset.square,
                    CropAspectRatioPreset.ratio4x3,
                    CropAspectRatioPreset.ratio16x9,
                  ]
                : const [CropAspectRatioPreset.square],
          ),
        ],
      );
      if (cropped == null) return;

      setState(() {
        if (isFamily) {
          _uploadingFamily = true;
        } else {
          _uploadingProfile = true;
        }
      });
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/members/upload?type=${isFamily ? 'family' : 'profile'}',
        filePath: cropped.path,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final path = resp.data?['path']?.toString();
      if (path != null && path.isNotEmpty) {
        setState(() {
          if (isFamily) {
            _familyPhotoPath = path;
          } else {
            _profilePhotoPath = path;
          }
        });
      } else {
        _snack('Upload failed', isError: true);
      }
    } catch (e) {
      _snack('Upload failed: $e', isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _uploadingFamily = false;
          _uploadingProfile = false;
        });
      }
    }
  }

  void _snack(String msg, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: isError ? AppColors.error : AppColors.success,
      ),
    );
  }

  _Country? _countryById(int? id) {
    if (id == null) return null;
    try {
      return _countries.firstWhere((c) => c.id == id);
    } catch (_) {
      return null;
    }
  }

  /// Resolve India's country id from the loaded list (match by name); fall back
  /// to 1 (India's id in this backend) if the list hasn't surfaced it.
  int _indiaCountryId() {
    for (final c in _countries) {
      if (c.name.toLowerCase().contains('india')) return c.id;
    }
    return 1;
  }

  /// India is the default country for ~98% of members, so pre-select it
  /// wherever no country has been chosen yet. The user can still change any of
  /// these in the dropdown. Also keeps fk*CountryId from ever being sent null.
  void _applyCountryDefaults() {
    final india = _indiaCountryId();
    final indiaName = _countryById(india)?.name;
    _primaryCountryId ??= india;
    _secondaryCountryId ??= india;
    if (_residential.fkCountryId == null) {
      _residential =
          _residential.copyWith(fkCountryId: india, country: indiaName);
    }
    if (_business.fkCountryId == null) {
      _business = _business.copyWith(fkCountryId: india, country: indiaName);
    }
    // Backfill India on any family member missing a country (new rows already
    // default to India; this catches existing rows stored with a null country,
    // which the non-nullable FamilyMemberDto.FkCountryId would otherwise reject).
    final indiaPhone = _countryById(india)?.phoneCode;
    _familyMembers = _familyMembers
        .map((f) => f.fkCountryId == null
            ? f.copyWith(
                fkCountryId: india,
                country: indiaName,
                countryPhoneCode: indiaPhone)
            : f)
        .toList();
  }

  // True when the user has filled in any meaningful field on the address.
  // Empty addresses are skipped at save time so the backend doesn't get a
  // payload with `fkCountryId: null`, which fails its non-nullable int parse.
  bool _hasAddressContent(MemberAddressModel a) {
    bool nz(String? s) => s != null && s.trim().isNotEmpty;
    // Country alone is NOT content: India is pre-selected by default, so an
    // address the user never filled would otherwise be saved as an empty row.
    return nz(a.state) ||
        nz(a.city) ||
        nz(a.pinCode) ||
        nz(a.address) ||
        nz(a.phoneNumber) ||
        nz(a.businessName) ||
        nz(a.businessEmailId) ||
        nz(a.designation) ||
        nz(a.classificationProfession) ||
        nz(a.keywords);
  }

  // Build the address payload, dropping `fkCountryId` when null so the
  // non-nullable int on the backend DTO doesn't reject it.
  Map<String, dynamic> _addressJson(MemberAddressModel a, String? countryName) {
    final json = a
        .copyWith(country: countryName ?? a.country)
        .toJson();
    if (json['fkCountryId'] == null) json.remove('fkCountryId');
    return json;
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final memberId = context.read<AuthProvider>().memberId;
    setState(() => _saving = true);

    // The API rejects a null fk*CountryId (non-nullable int → validation 400),
    // so fall back to India if either is somehow still unset.
    final india = _indiaCountryId();
    final primaryCountryId = _primaryCountryId ?? india;
    final secondaryCountryId = _secondaryCountryId ?? india;
    final primaryCountry = _countryById(primaryCountryId);
    final secondaryCountry = _countryById(secondaryCountryId);
    final residentialCountry = _countryById(_residential.fkCountryId);
    final businessCountry = _countryById(_business.fkCountryId);

    final addresses = <Map<String, dynamic>>[];
    if (_hasAddressContent(_residential)) {
      addresses.add(_addressJson(_residential, residentialCountry?.name));
    }
    if (_hasAddressContent(_business)) {
      addresses.add(_addressJson(_business, businessCountry?.name));
    }

    final body = <String, dynamic>{
      if (_original != null) ..._original!.toJson(),
      'memberName': _name.text.trim(),
      'emailId': _email.text.trim(),
      'fkPrimaryCountryId': primaryCountryId,
      'primaryCountry': primaryCountry?.name,
      'primaryCountryPhoneCode': primaryCountry?.phoneCode,
      'primaryMobileNumber': _mobile.text.trim(),
      'fkSecondaryCountryId': secondaryCountryId,
      'secondaryCountry': secondaryCountry?.name,
      'secondaryCountryPhoneCode': secondaryCountry?.phoneCode,
      'secondaryMobileNumber': _altMobile.text.trim(),
      'birthDate': _birthDate != null ? _formatForApi(_birthDate!) : null,
      'anniversaryDate':
          _anniversaryDate != null ? _formatForApi(_anniversaryDate!) : null,
      'bloodGroup': _bloodGroup,
      'gender': _gender,
      'primaryLanguage': _language,
      'rotaryId': _rotaryId.text.trim(),
      'donorRecognition': _donorRecognition.text.trim(),
      'memberIntroduction': _intro.text.trim(),
      'facebook': _facebook.text.trim(),
      'instagram': _instagram.text.trim(),
      'linkedIn': _linkedIn.text.trim(),
      'twitter': _twitter.text.trim(),
      'youtube': _youtube.text.trim(),
      'website': _website.text.trim(),
      'isPersonalDetailsVisible': _personalVisible,
      'isFamilyDetailsVisible': _familyVisible,
      'isHonoraryMember': _isHonorary,
      'isYouth': _isYouth,
      'profilePhotoPath': _profilePhotoPath,
      'familyPhotoPath': _familyPhotoPath,
      // Member-level (club_members) — backend reads these top-level, NOT nested
      // under addresses (Step 11B, 2026-06-18). The Business tab edits them.
      'designation': (_business.designation ?? '').trim(),
      'classificationProfession':
          (_business.classificationProfession ?? '').trim(),
      'addresses': addresses,
      'familyMembers': _familyMembers.map((f) => f.toJson()).toList(),
    };

    try {
      await _api.put('/api/members/$memberId', body: body);
      if (!mounted) return;
      invalidateShareContactCache();
      await context.read<AuthProvider>().refreshProfilePhoto();
      if (!mounted) return;
      _snack('Profile updated successfully');
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      _snack(e.message, isError: true);
    } catch (e) {
      _snack('Failed: $e', isError: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // ── Build ──────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      bottomNavigationBar: _loading || _error != null
          ? null
          : RowFormActionBar(
              child: CustomButton(label: 'Save', onPressed: _save, isLoading: _saving, fullWidth: true),
            ),
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Edit Profile',
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Material(
            color: AppColors.lightBg,
            child: TabBar(
              controller: _tab,
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              labelStyle: AppFonts.body(
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
              tabs: const [
                Tab(text: 'Personal'),
                Tab(text: 'Social'),
                Tab(text: 'Residential'),
                Tab(text: 'Business'),
                Tab(text: 'Family'),
              ],
            ),
          ),
        ),
      ),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.error_outline,
                            color: AppColors.error, size: 48),
                        const SizedBox(height: 12),
                        Text('Failed to load: $_error',
                            textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        ElevatedButton(
                            onPressed: _load, child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              : Form(
                  key: _formKey,
                  autovalidateMode: AutovalidateMode.onUserInteraction,
                  child: TabBarView(
                    controller: _tab,
                    children: [
                      _personalTab(),
                      _socialTab(),
                      _addressTab(
                        title: 'Residential Address',
                        addr: _residential,
                        update: (v) => setState(() => _residential = v),
                      ),
                      _businessTab(),
                      _familyTab(),
                    ],
                  ),
                ),
    );
  }

  // ── Tabs ───────────────────────────────────────────────────────────────

  Widget _personalTab() {
    return _tabScroll([
      _photoCard(
        path: _profilePhotoPath,
        uploading: _uploadingProfile,
        label: 'Profile Photo',
        onTap: () => _pickPhoto(isFamily: false),
        circular: true,
      ),
      _input(_name, 'Full Name', required: true),
      _input(_email, 'Email',
          required: true, locked: true, keyboard: TextInputType.emailAddress),
      _input(_mobile, 'Mobile Number',
          required: true,
          locked: true,
          keyboard: TextInputType.phone,
          formatters: [FilteringTextInputFormatter.digitsOnly]),
      _countryDropdown(
        label: 'Country',
        value: _primaryCountryId,
        onChanged: (v) => setState(() => _primaryCountryId = v),
      ),
      _datePickerField(
        label: 'Date of Birth',
        value: _birthDate,
        onPicked: (d) => setState(() => _birthDate = d),
      ),
      _datePickerField(
        label: 'Anniversary Date',
        value: _anniversaryDate,
        onPicked: (d) => setState(() => _anniversaryDate = d),
      ),
      _staticDropdown(
        label: 'Blood Group',
        value: _bloodGroup,
        items: FormConstants.bloodGroups,
        onChanged: (v) => setState(() => _bloodGroup = v),
      ),
      _staticDropdown(
        label: 'Gender',
        value: _gender,
        items: FormConstants.genders,
        onChanged: (v) => setState(() => _gender = v),
      ),
      _staticDropdown(
        label: 'Primary Language',
        value: _language,
        items: FormConstants.languages,
        onChanged: (v) => setState(() => _language = v),
      ),
      _countryDropdown(
        label: 'Secondary Country',
        value: _secondaryCountryId,
        onChanged: (v) => setState(() => _secondaryCountryId = v),
      ),
      _input(_altMobile, 'Secondary Mobile',
          keyboard: TextInputType.phone,
          formatters: [FilteringTextInputFormatter.digitsOnly]),
      _input(_rotaryId, 'Rotary ID',
          required: true,
          locked: true,
          formatters: [FilteringTextInputFormatter.digitsOnly]),
      _input(_donorRecognition, 'Donor Recognition'),
      const SizedBox(height: 8),
      _switchRow(
        label: 'Personal Details Visible',
        value: _personalVisible,
        onChanged: (v) => setState(() => _personalVisible = v),
      ),
      // Honorary Member & Youth Member toggles hidden from the edit profile UI
      // (not user-editable). The loaded values are still preserved and sent in
      // the save payload, so the member's existing flags are untouched.
      const SizedBox(height: 8),
      _input(_intro, 'Introduction',
          maxLines: 3, hint: 'Brief introduction about you...'),
    ]);
  }

  Widget _socialTab() {
    return _tabScroll([
      _input(_facebook, 'Facebook URL',
          keyboard: TextInputType.url, prefixIcon: Icons.facebook_outlined),
      _input(_instagram, 'Instagram URL',
          keyboard: TextInputType.url, prefixIcon: Icons.camera_alt_outlined),
      _input(_linkedIn, 'LinkedIn URL',
          keyboard: TextInputType.url, prefixIcon: Icons.work_outline),
      _input(_twitter, 'Twitter / X URL',
          keyboard: TextInputType.url, prefixIcon: Icons.alternate_email),
      _input(_youtube, 'YouTube URL',
          keyboard: TextInputType.url, prefixIcon: Icons.play_circle_outline),
      _input(_website, 'Website URL',
          keyboard: TextInputType.url, prefixIcon: Icons.public_outlined),
    ]);
  }

  Widget _addressTab({
    required String title,
    required MemberAddressModel addr,
    required void Function(MemberAddressModel) update,
  }) {
    return _tabScroll([
      _sectionLabel(title),
      _countryDropdown(
        label: 'Country',
        value: addr.fkCountryId,
        onChanged: (v) => update(addr.copyWith(fkCountryId: v)),
      ),
      _initInput(
        label: 'Phone Number',
        initial: addr.phoneNumber ?? '',
        keyboard: TextInputType.phone,
        onChanged: (v) => update(addr.copyWith(phoneNumber: v)),
      ),
      _initInput(
        label: 'Address',
        initial: addr.address ?? '',
        maxLines: 3,
        onChanged: (v) => update(addr.copyWith(address: v)),
      ),
      _initInput(
        label: 'State',
        initial: addr.state ?? '',
        onChanged: (v) => update(addr.copyWith(state: v)),
      ),
      _initInput(
        label: 'City',
        initial: addr.city ?? '',
        onChanged: (v) => update(addr.copyWith(city: v)),
      ),
      _initInput(
        label: 'PIN Code',
        initial: addr.pinCode ?? '',
        keyboard: TextInputType.number,
        formatters: [FilteringTextInputFormatter.digitsOnly],
        onChanged: (v) => update(addr.copyWith(pinCode: v)),
      ),
    ]);
  }

  Widget _businessTab() {
    final addr = _business;
    void update(MemberAddressModel v) => setState(() => _business = v);
    return _tabScroll([
      _sectionLabel('Business Details'),
      _initInput(
        label: 'Business Name',
        initial: addr.businessName ?? '',
        onChanged: (v) => update(addr.copyWith(businessName: v)),
      ),
      _initInput(
        label: 'Business Email',
        initial: addr.businessEmailId ?? '',
        keyboard: TextInputType.emailAddress,
        onChanged: (v) => update(addr.copyWith(businessEmailId: v)),
      ),
      _initInput(
        label: 'Designation',
        initial: addr.designation ?? '',
        onChanged: (v) => update(addr.copyWith(designation: v)),
      ),
      _initInput(
        label: 'Classification / Profession',
        initial: addr.classificationProfession ?? '',
        onChanged: (v) =>
            update(addr.copyWith(classificationProfession: v)),
      ),
      _initInput(
        label: 'Keywords',
        initial: addr.keywords ?? '',
        onChanged: (v) => update(addr.copyWith(keywords: v)),
      ),
      _countryDropdown(
        label: 'Country',
        value: addr.fkCountryId,
        onChanged: (v) => update(addr.copyWith(fkCountryId: v)),
      ),
      _initInput(
        label: 'Phone Number',
        initial: addr.phoneNumber ?? '',
        keyboard: TextInputType.phone,
        onChanged: (v) => update(addr.copyWith(phoneNumber: v)),
      ),
      _initInput(
        label: 'Address',
        initial: addr.address ?? '',
        maxLines: 3,
        onChanged: (v) => update(addr.copyWith(address: v)),
      ),
      _initInput(
        label: 'State',
        initial: addr.state ?? '',
        onChanged: (v) => update(addr.copyWith(state: v)),
      ),
      _initInput(
        label: 'City',
        initial: addr.city ?? '',
        onChanged: (v) => update(addr.copyWith(city: v)),
      ),
      _initInput(
        label: 'PIN Code',
        initial: addr.pinCode ?? '',
        keyboard: TextInputType.number,
        formatters: [FilteringTextInputFormatter.digitsOnly],
        onChanged: (v) => update(addr.copyWith(pinCode: v)),
      ),
    ]);
  }

  Widget _familyTab() {
    return _tabScroll([
      _photoCard(
        path: _familyPhotoPath,
        uploading: _uploadingFamily,
        label: 'Family Photo',
        onTap: () => _pickPhoto(isFamily: true),
        circular: false,
      ),
      _switchRow(
        label: 'Family Details Visible',
        value: _familyVisible,
        onChanged: (v) => setState(() => _familyVisible = v),
      ),
      const SizedBox(height: 8),
      Row(
        children: [
          Expanded(
            child: Text('Family Members',
                style: AppTextStyles.bodyMedium.copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.w700,
                )),
          ),
          TextButton.icon(
            onPressed: () {
              setState(() {
                // New family member defaults to India (matches the rest of the
                // form); the user can change it in the row's country dropdown.
                final india = _indiaCountryId();
                _familyMembers.add(
                  FamilyMemberModel(
                    name: '',
                    relation: '',
                    fkCountryId: india,
                    country: _countryById(india)?.name,
                    countryPhoneCode: _countryById(india)?.phoneCode,
                  ),
                );
              });
            },
            icon: const Icon(Icons.add, color: AppColors.primary, size: 18),
            label: Text(
              'Add Member',
              style: AppTextStyles.body.copyWith(
                color: AppColors.primary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
      if (_familyMembers.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 24),
          child: Text(
            'No family members added.',
            textAlign: TextAlign.center,
            style: AppTextStyles.caption.copyWith(color: AppColors.textMuted),
          ),
        ),
      for (var i = 0; i < _familyMembers.length; i++)
        _familyMemberCard(i),
    ]);
  }

  Widget _familyMemberCard(int index) {
    final f = _familyMembers[index];
    void update(FamilyMemberModel v) =>
        setState(() => _familyMembers[index] = v);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.25)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              _familyMemberAvatar(index, f),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Family Member #${index + 1}',
                      style: AppTextStyles.bodyMedium
                          .copyWith(color: AppColors.primary),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      (f.photoPath == null || f.photoPath!.isEmpty)
                          ? 'Tap the photo to add'
                          : 'Tap the photo to change',
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, color: AppColors.error),
                onPressed: () => setState(() {
                  _familyMembers.removeAt(index);
                  _uploadingMemberPhoto.remove(index);
                }),
              ),
            ],
          ),
          const SizedBox(height: 20),
          _initInput(
            label: 'Name',
            initial: f.name,
            onChanged: (v) => update(f.copyWith(name: v)),
          ),
          _staticDropdown(
            label: 'Relation',
            value: FormConstants.relations.contains(f.relation) ? f.relation : null,
            items: FormConstants.relations,
            onChanged: (v) => update(f.copyWith(relation: v ?? '')),
          ),
          _staticDropdown(
            label: 'Blood Group',
            value: FormConstants.bloodGroups.contains(f.bloodGroup) ? f.bloodGroup : null,
            items: FormConstants.bloodGroups,
            onChanged: (v) => update(f.copyWith(bloodGroup: v)),
          ),
          _countryDropdown(
            label: 'Country',
            value: f.fkCountryId,
            onChanged: (v) {
              final c = _countryById(v);
              update(f.copyWith(
                fkCountryId: v,
                country: c?.name,
                countryPhoneCode: c?.phoneCode,
              ));
            },
          ),
          _initInput(
            label: 'Phone Number',
            initial: f.contact ?? '',
            keyboard: TextInputType.phone,
            formatters: [FilteringTextInputFormatter.digitsOnly],
            onChanged: (v) => update(f.copyWith(contact: v)),
          ),
          _initInput(
            label: 'Email',
            initial: f.email ?? '',
            keyboard: TextInputType.emailAddress,
            onChanged: (v) => update(f.copyWith(email: v)),
          ),
          _datePickerField(
            label: 'Date of Birth',
            value: _parseDate(f.birthDate),
            onPicked: (d) =>
                update(f.copyWith(birthDate: d == null ? null : _formatForApi(d))),
          ),
          _datePickerField(
            label: 'Anniversary',
            value: _parseDate(f.anniversaryDate),
            onPicked: (d) => update(f.copyWith(
                anniversaryDate: d == null ? null : _formatForApi(d))),
          ),
        ],
      ),
    );
  }

  // Tappable circular avatar for one family member's photo (upload / change).
  Widget _familyMemberAvatar(int index, FamilyMemberModel f) {
    final uploading = _uploadingMemberPhoto.contains(index);
    final url = (f.photoPath == null || f.photoPath!.isEmpty)
        ? ''
        : ApiConstants.mediaUrl(f.photoPath!);
    return GestureDetector(
      onTap: uploading ? null : () => _pickFamilyMemberPhoto(index),
      child: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: AppColors.primaryLight,
          border: Border.all(
              color: AppColors.primary.withValues(alpha: 0.3), width: 2),
        ),
        clipBehavior: Clip.antiAlias,
        child: uploading
            ? const Center(
                child: const CircularProgressIndicator(
                    color: AppColors.primary, strokeWidth: 2.2))
            : url.isEmpty
                ? const Icon(Icons.add_a_photo_outlined,
                    color: AppColors.primary, size: 22)
                : Image.network(
                    url,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const Icon(Icons.person_outline,
                        color: AppColors.textMuted),
                  ),
      ),
    );
  }

  // Pick → crop (square, matches the circular avatar) → upload one family
  // member's photo, then stamp the returned path onto that row. Mirrors
  // `_pickPhoto` but targets a single family member by index.
  Future<void> _pickFamilyMemberPhoto(int index) async {
    try {
      final picker = ImagePicker();
      final picked =
          await picker.pickImage(source: ImageSource.gallery, maxWidth: 1200);
      if (picked == null) return;
      final cropped = await ImageCropper().cropImage(
        sourcePath: picked.path,
        aspectRatio: const CropAspectRatio(ratioX: 1, ratioY: 1),
        compressQuality: 90,
        uiSettings: [
          AndroidUiSettings(
            toolbarTitle: 'Crop Photo',
            toolbarColor: AppColors.primary,
            toolbarWidgetColor: Colors.white,
            activeControlsWidgetColor: AppColors.primary,
            lockAspectRatio: true,
            initAspectRatio: CropAspectRatioPreset.square,
            aspectRatioPresets: const [CropAspectRatioPreset.square],
          ),
          IOSUiSettings(
            title: 'Crop Photo',
            aspectRatioLockEnabled: true,
            aspectRatioPresets: const [CropAspectRatioPreset.square],
          ),
        ],
      );
      if (cropped == null) return;

      setState(() => _uploadingMemberPhoto.add(index));
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        '/api/members/upload?type=family',
        filePath: cropped.path,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final path = resp.data?['path']?.toString();
      if (path != null && path.isNotEmpty) {
        if (!mounted) return;
        setState(() {
          // The row may have been removed while the upload was in flight.
          if (index < _familyMembers.length) {
            _familyMembers[index] =
                _familyMembers[index].copyWith(photoPath: path);
          }
        });
      } else {
        _snack('Upload failed', isError: true);
      }
    } catch (e) {
      _snack('Upload failed: $e', isError: true);
    } finally {
      if (mounted) setState(() => _uploadingMemberPhoto.remove(index));
    }
  }

  // ── Reusable widgets ───────────────────────────────────────────────────

  Widget _tabScroll(List<Widget> children) {
    final spaced = <Widget>[];
    for (var i = 0; i < children.length; i++) {
      spaced.add(children[i]);
      if (i != children.length - 1) {
        final cur = children[i];
        final isHeader = cur is _SectionHeader;
        spaced.add(SizedBox(height: isHeader ? 4 : 12));
      }
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: spaced,
    );
  }

  Widget _input(
    TextEditingController controller,
    String label, {
    bool required = false,
    bool locked = false,
    TextInputType keyboard = TextInputType.text,
    int? maxLines,
    String? hint,
    IconData? prefixIcon,
    List<TextInputFormatter>? formatters,
  }) {
    return TextFormField(
      controller: controller,
      // Mobile self-edit lock: the backend silently reverts mobile / email /
      // Rotary ID to their stored values for any mobile self-edit (changes there
      // need admin approval — they feed login + billing). Keep the value visible
      // and still sent, but read-only so the user isn't shown an edit that the
      // server will discard.
      readOnly: locked,
      keyboardType: keyboard,
      maxLines: maxLines ?? 1,
      inputFormatters: formatters,
      decoration:
          _decoration(label, required: required, hint: hint, icon: prefixIcon, locked: locked),
      validator: required
          ? (v) => (v == null || v.trim().isEmpty) ? '$label is required' : null
          : null,
    );
  }

  /// One-shot input bound by initial value (no controller). Used when a parent
  /// model holds the source of truth (addresses, family members).
  Widget _initInput({
    required String label,
    required String initial,
    TextInputType keyboard = TextInputType.text,
    int? maxLines,
    String? hint,
    List<TextInputFormatter>? formatters,
    required void Function(String) onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        initialValue: initial,
        keyboardType: keyboard,
        maxLines: maxLines ?? 1,
        inputFormatters: formatters,
        decoration: _decoration(label, hint: hint),
        onChanged: onChanged,
      ),
    );
  }

  InputDecoration _decoration(
    String label, {
    bool required = false,
    String? hint,
    IconData? icon,
    bool locked = false,
  }) {
    return InputDecoration(
      labelText: required ? '$label *' : label,
      hintText: hint,
      prefixIcon: icon != null ? Icon(icon, size: 20) : null,
      suffixIcon: locked
          ? const Icon(Icons.lock_outline, size: 18, color: AppColors.textMuted)
          : null,
      helperText: locked ? 'Contact your club admin to change this' : null,
      filled: locked,
      fillColor: locked ? AppColors.border.withValues(alpha: 0.18) : null,
      isDense: true,
      contentPadding:
          const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: AppColors.primary),
      ),
    );
  }

  Widget _staticDropdown({
    required String label,
    required String? value,
    required List<String> items,
    required void Function(String?) onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: DropdownButtonFormField<String>(
        initialValue: value,
        isExpanded: true,
        decoration: _decoration(label),
        items: [
          for (final item in items)
            DropdownMenuItem(value: item, child: Text(item)),
        ],
        onChanged: onChanged,
      ),
    );
  }

  Widget _countryDropdown({
    required String label,
    required int? value,
    required void Function(int?) onChanged,
  }) {
    final items = _countries
        .map((c) => DropdownMenuItem<int>(
              value: c.id,
              child: Text(
                c.phoneCode != null && c.phoneCode!.isNotEmpty
                    ? '${c.name} (${c.phoneCode})'
                    : c.name,
                overflow: TextOverflow.ellipsis,
              ),
            ))
        .toList();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: DropdownButtonFormField<int>(
        initialValue: _countries.any((c) => c.id == value) ? value : null,
        isExpanded: true,
        decoration: _decoration(label),
        items: items,
        onChanged: onChanged,
      ),
    );
  }

  Widget _datePickerField({
    required String label,
    required DateTime? value,
    required void Function(DateTime?) onPicked,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: () async {
          final picked = await _pickDate(value);
          if (picked != null) onPicked(picked);
        },
        borderRadius: BorderRadius.circular(10),
        child: InputDecorator(
          decoration: _decoration(label, icon: Icons.calendar_today_outlined),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  value != null ? _formatDisplay(value) : 'Select date',
                  style: AppTextStyles.body.copyWith(
                    color: value != null
                        ? AppColors.textPrimary
                        : AppColors.textMuted,
                  ),
                ),
              ),
              if (value != null)
                IconButton(
                  icon: const Icon(Icons.clear, size: 18),
                  onPressed: () => onPicked(null),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _switchRow({
    required String label,
    required bool value,
    required void Function(bool) onChanged,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(label,
                style: AppTextStyles.bodyMedium
                    .copyWith(color: AppColors.textPrimary)),
          ),
          Switch.adaptive(
            value: value,
            activeThumbColor: AppColors.primary,
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }

  Widget _photoCard({
    required String? path,
    required bool uploading,
    required String label,
    required VoidCallback onTap,
    required bool circular,
  }) {
    final url =
        path == null || path.isEmpty ? '' : ApiConstants.mediaUrl(path);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          GestureDetector(
            onTap: uploading ? null : onTap,
            // Family photo (non-circular) with an image: size the frame to the
            // image's own aspect ratio so the full crop shows, never cut.
            child: (!circular && !uploading && url.isNotEmpty)
                ? Container(
                    width: 100,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                          color: AppColors.primary.withValues(alpha: 0.3),
                          width: 2),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: AspectRatioNetworkImage(
                      url: url,
                      fallbackRatio: 100 / 84,
                      errorWidget: const SizedBox(
                        height: 84,
                        child: Center(
                          child: Icon(Icons.image_not_supported_outlined,
                              color: AppColors.textMuted),
                        ),
                      ),
                    ),
                  )
                : Container(
                    width: circular ? 84 : 100,
                    height: 84,
                    decoration: BoxDecoration(
                      shape: circular ? BoxShape.circle : BoxShape.rectangle,
                      borderRadius: circular ? null : BorderRadius.circular(10),
                      color: AppColors.primaryLight,
                      border: Border.all(
                          color: AppColors.primary.withValues(alpha: 0.3),
                          width: 2),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: uploading
                        ? const Center(
                            child: const CircularProgressIndicator(
                                color: AppColors.primary, strokeWidth: 2.5))
                        : url.isEmpty
                            ? const Icon(Icons.add_a_photo_outlined,
                                color: AppColors.primary, size: 32)
                            : Image.network(
                                url,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) => const Icon(
                                    Icons.image_not_supported_outlined,
                                    color: AppColors.textMuted),
                              ),
                  ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: AppTextStyles.bodyMedium),
                const SizedBox(height: 4),
                Text(
                  'Tap to ${url.isEmpty ? 'upload' : 'change'}',
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionLabel(String label) => _SectionHeader(label);
}

class _SectionHeader extends StatelessWidget {
  final String text;
  const _SectionHeader(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: AppTextStyles.bodyMedium.copyWith(
          color: AppColors.primary,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
