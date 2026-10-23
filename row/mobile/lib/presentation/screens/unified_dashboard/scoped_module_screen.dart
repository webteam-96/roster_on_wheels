import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../districts/modules/district_members_screen.dart';
import '../districts/modules/district_website_data_screen.dart';
import '../districts/modules/district_cmr_screen.dart';
import '../districts/modules/district_upcoming_events_screen.dart';
import '../districts/modules/district_announcements_screen.dart';
import '../districts/modules/district_newsletters_screen.dart';
import '../districts/modules/district_documents_screen.dart';
import '../districts/modules/district_greetings_screen.dart';
import '../districts/modules/district_reports_screen.dart';
import '../districts/modules/district_online_event_link_screen.dart';
import '../districts/modules/district_weblinks_screen.dart';
import '../districts/modules/district_sub_groups_screen.dart';
import '../districts/modules/district_mass_emails_screen.dart';
import '../clubs/modules/members/club_members_screen.dart';
import '../clubs/modules/website_data/club_website_data_hub_screen.dart';
import '../clubs/modules/club_monthly_report/club_monthly_report_screen.dart';
import '../clubs/modules/upcoming_events/upcoming_events_screen.dart';
import '../clubs/modules/announcements/announcements_screen.dart';
import '../clubs/modules/newsletters/newsletters_screen.dart';
import '../clubs/modules/documents/documents_screen.dart';
import '../clubs/modules/greetings/greetings_screen.dart';
import '../clubs/modules/event_payment_links/event_payment_links_screen.dart';
import '../clubs/modules/weblinks/weblinks_screen.dart';
import '../clubs/modules/sub_groups/sub_groups_screen.dart';
import '../clubs/modules/mass_emails/mass_emails_screen.dart';

class ScopedModuleScreen extends StatelessWidget {
  final String moduleKey;
  final int districtId;
  final int clubId;

  const ScopedModuleScreen({
    super.key,
    required this.moduleKey,
    required this.districtId,
    required this.clubId,
  });

  String _normalize(String key) =>
      key.toLowerCase().replaceAll('_', '').replaceAll('-', '').replaceAll(' ', '');

  String _moduleNameFromKey(String key) {
    return key
        .replaceAll('_', ' ')
        .replaceAll('-', ' ')
        .split(' ')
        .map((w) => w.isEmpty ? '' : '${w[0].toUpperCase()}${w.substring(1)}')
        .join(' ');
  }

  Widget _buildDistrictWidget(String moduleKey, int districtId) {
    switch (_normalize(moduleKey)) {
      case 'directory':
        return DistrictMembersScreen(districtId: districtId, embedded: true);
      case 'websitedata':
        return DistrictWebsiteDataScreen(districtId: districtId, embedded: true);
      case 'clubmonthlyreport':
        return DistrictCmrScreen(districtId: districtId, embedded: true);
      case 'upcomingevents':
        return DistrictUpcomingEventsScreen(districtId: districtId, embedded: true);
      case 'announcements':
        return DistrictAnnouncementsScreen(districtId: districtId, embedded: true);
      case 'newsletters':
        return DistrictNewslettersScreen(districtId: districtId, embedded: true);
      case 'documents':
        return DistrictDocumentsScreen(districtId: districtId, embedded: true);
      case 'greetings':
        return DistrictGreetingsScreen(districtId: districtId, embedded: true);
      case 'reports':
        return DistrictReportsScreen(districtId: districtId, embedded: true);
      case 'onlineeventlink':
        return DistrictOnlineEventLinkScreen(districtId: districtId, embedded: true);
      case 'weblinks':
        return DistrictWeblinksScreen(districtId: districtId, embedded: true);
      case 'subgroups':
        return DistrictSubGroupsScreen(districtId: districtId, embedded: true);
      case 'massemail':
        return DistrictMassEmailsScreen(districtId: districtId, embedded: true);
      default:
        return const Center(child: Text('Module not available'));
    }
  }

  /// Per-level gating: pass `viewOnly: true` to every club module when the
  /// signed-in user isn't a club admin of THIS club. Mirrors what
  /// `unified_module_detail_screen.dart` does. Without this, a Member who
  /// happens to be a club admin elsewhere can still hit edit/save buttons
  /// inside a "city view" of a club they don't manage.
  Widget _buildClubWidget(String moduleKey, int clubId, bool viewOnly) {
    switch (_normalize(moduleKey)) {
      case 'directory':
        return ClubMembersScreen(clubId: clubId, embedded: true);
      case 'websitedata':
        return ClubWebsiteDataHubScreen(clubId: clubId, embedded: true);
      case 'clubmonthlyreport':
        return ClubMonthlyReportScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'upcomingevents':
        return UpcomingEventsScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'announcements':
        return AnnouncementsScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'newsletters':
        return NewslettersScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'documents':
        return DocumentsScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'greetings':
        return GreetingsScreen(clubId: clubId, embedded: true);
      case 'onlineeventlink':
        return EventPaymentLinksScreen(clubId: clubId, embedded: true);
      case 'weblinks':
        return WeblinksScreen(clubId: clubId, embedded: true);
      case 'subgroups':
        return SubGroupsScreen(clubId: clubId, embedded: true, viewOnly: viewOnly);
      case 'massemail':
        return MassEmailsScreen(clubId: clubId, embedded: true);
      default:
        return const Center(child: Text('Module not available'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final moduleName = _moduleNameFromKey(moduleKey);
    final auth = context.watch<AuthProvider>();
    // City view is a read-only context unless the user actually manages
    // that club/district. Pass viewOnly through so embedded screens hide
    // edit/save/delete affordances.
    final clubViewOnly = !auth.isClubAdminOf(clubId);
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: CustomAppBar(
          title: moduleName,
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Club'),
              Tab(text: 'District'),
            ],
            labelColor: Colors.white,
            indicatorColor: AppColors.goldPrime,
            unselectedLabelColor: Colors.white70,
          ),
        ),
        body: TabBarView(
          children: [
            _buildClubWidget(moduleKey, clubId, clubViewOnly),
            _buildDistrictWidget(moduleKey, districtId),
          ],
        ),
      ),
    );
  }
}
