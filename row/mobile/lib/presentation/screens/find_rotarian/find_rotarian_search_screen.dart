import 'package:flutter/material.dart' hide Text;
import '../../../core/theme/app_colors.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/common/custom_text_field.dart';
import 'find_rotarian_results_screen.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class FindRotarianSearchScreen extends StatefulWidget {
  const FindRotarianSearchScreen({super.key});

  @override
  State<FindRotarianSearchScreen> createState() => _FindRotarianSearchScreenState();
}

class _FindRotarianSearchScreenState extends State<FindRotarianSearchScreen> {
  final _nameCtrl = TextEditingController();
  final _keywordCtrl = TextEditingController();
  final _cityCtrl = TextEditingController();
  final _clubCtrl = TextEditingController();
  final _districtCtrl = TextEditingController();
  final _mobileCtrl = TextEditingController();

  @override
  void dispose() {
    _nameCtrl.dispose();
    _keywordCtrl.dispose();
    _cityCtrl.dispose();
    _clubCtrl.dispose();
    _districtCtrl.dispose();
    _mobileCtrl.dispose();
    super.dispose();
  }

  void _onSearch() {
    FocusScope.of(context).unfocus();
    final qp = <String, dynamic>{};
    final name = _nameCtrl.text.trim();
    final keyword = _keywordCtrl.text.trim();
    final city = _cityCtrl.text.trim();
    final club = _clubCtrl.text.trim();
    final district = _districtCtrl.text.trim();
    final mobile = _mobileCtrl.text.trim();
    if (name.isNotEmpty) qp['name'] = name;
    if (keyword.isNotEmpty) qp['keyword'] = keyword;
    if (city.isNotEmpty) qp['city'] = city;
    if (club.isNotEmpty) qp['clubName'] = club;
    if (district.isNotEmpty) qp['districtNumber'] = district;
    if (mobile.isNotEmpty) qp['mobile'] = mobile;

    if (qp.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter at least one search criterion.')),
      );
      return;
    }

    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => FindRotarianResultsScreen(queryParams: qp),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Find a Rotarian'),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _intro(),
                    const SizedBox(height: 14),
                    _sectionCard(
                      child: Column(
                        children: [
                          CustomTextField(
                            label: 'Name',
                            hint: 'Enter name',
                            controller: _nameCtrl,
                            prefixIcon: Icons.person_outline_rounded,
                          ),
                          const SizedBox(height: 14),
                          CustomTextField(
                            label: 'Classification / Keyword',
                            hint: 'Search profession, business, keywords',
                            controller: _keywordCtrl,
                            prefixIcon: Icons.badge_outlined,
                          ),
                          const SizedBox(height: 14),
                          CustomTextField(
                            label: 'City',
                            hint: 'Enter city',
                            controller: _cityCtrl,
                            prefixIcon: Icons.place_outlined,
                          ),
                          const SizedBox(height: 14),
                          CustomTextField(
                            label: 'Club',
                            hint: 'Search club name or Rotary ID',
                            controller: _clubCtrl,
                            prefixIcon: Icons.groups_outlined,
                          ),
                          const SizedBox(height: 14),
                          CustomTextField(
                            label: 'District Number',
                            hint: 'Search district number',
                            controller: _districtCtrl,
                            keyboardType: TextInputType.number,
                            prefixIcon: Icons.tag_rounded,
                          ),
                          const SizedBox(height: 14),
                          CustomTextField(
                            label: 'Mobile Number',
                            hint: 'Search mobile number',
                            controller: _mobileCtrl,
                            keyboardType: TextInputType.phone,
                            prefixIcon: Icons.phone_outlined,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Container(
              decoration: const BoxDecoration(
                color: AppColors.white,
                border: const Border(top: const BorderSide(color: AppColors.border)),
              ),
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 14),
              child: CustomButton(
                label: 'Search',
                icon: Icons.search_rounded,
                onPressed: _onSearch,
                fullWidth: true,
                height: 52,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _intro() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.primaryPrime.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.primaryPrime.withValues(alpha: 0.15)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline_rounded, size: 18, color: AppColors.primaryPrime),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              "Search any Rotarian from '${Brand.current.productName}' subscribed clubs. "
              "Fill any combination of filters below.",
              style: AppFonts.body(
                fontSize: 13,
                color: AppColors.textSecondary,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionCard({required Widget child}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),

      ),
      child: child,
    );
  }
}
