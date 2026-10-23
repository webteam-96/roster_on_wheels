import 'package:flutter/material.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';

/// One column in the exported XLSX. Mirrors the web frontend's column shape
/// (key, label, width) so XLSX output is field-for-field consistent across
/// platforms. `hyperlink: true` renders the value as an Excel hyperlink cell.
class AgReportColumn {
  final String key;
  final String label;
  final double width;
  final bool hyperlink;
  const AgReportColumn(
    this.key,
    this.label, {
    this.width = 18,
    this.hyperlink = false,
  });
}

/// A single report definition — endpoint path + display metadata + columns.
class AgReportConfig {
  final String id; // url path suffix under /api/ag/reports/...
  final String title;
  final String fileName;
  final IconData icon;
  final Color color;
  final bool yearScoped;
  final List<AgReportColumn> columns;
  const AgReportConfig({
    required this.id,
    required this.title,
    required this.fileName,
    required this.icon,
    required this.color,
    required this.columns,
    this.yearScoped = false,
  });
}

class AgReportSection {
  final String id;
  final String title;
  final IconData icon;
  final List<AgReportConfig> items;
  const AgReportSection({
    required this.id,
    required this.title,
    required this.icon,
    required this.items,
  });
}

const kAgReportSections = <AgReportSection>[
  AgReportSection(
    id: 'clubs',
    title: 'My Clubs',
    icon: Icons.business_outlined,
    items: [
      AgReportConfig(
        id: 'clubs',
        title: 'All My Clubs',
        fileName: 'MyClubs',
        icon: Icons.business_outlined,
        color: AppColors.goldDark,
        columns: [
          AgReportColumn('clubName', 'Club Name', width: 35),
          AgReportColumn('clubRotaryId', 'Club Rotary ID', width: 16),
          AgReportColumn('districtNumber', 'District', width: 12),
          AgReportColumn('city', 'City', width: 18),
          AgReportColumn('state', 'State', width: 18),
          AgReportColumn('meetingDay', 'Meeting Day', width: 14),
          AgReportColumn('meetingFromTime', 'From', width: 10),
          AgReportColumn('meetingToTime', 'To', width: 10),
          AgReportColumn('meetingAddress', 'Meeting Address', width: 40),
          AgReportColumn('totalMembers', 'Members', width: 10),
          AgReportColumn('isActive', 'Active', width: 10),
          AgReportColumn('charterDate', 'Charter Date', width: 16),
        ],
      ),
      AgReportConfig(
        id: 'club-websites',
        title: 'Club Websites',
        fileName: 'MyClubs_Websites',
        icon: Icons.public,
        color: AppColors.success,
        columns: [
          AgReportColumn('clubName', 'Club', width: 35),
          AgReportColumn('districtNumber', 'District', width: 12),
          AgReportColumn('clubWebsite', 'Website', width: 50),
        ],
      ),
      AgReportConfig(
        id: 'club-leadership',
        title: 'Club Leadership (President & Secretary)',
        fileName: 'MyClubs_Leadership',
        icon: Icons.emoji_events_outlined,
        color: AppColors.accentBlue,
        yearScoped: true,
        columns: [
          AgReportColumn('clubName', 'Club', width: 35),
          AgReportColumn('yearLabel', 'Year', width: 12),
          AgReportColumn('designation', 'Designation', width: 20),
          AgReportColumn('memberName', 'Name', width: 28),
          AgReportColumn('mobile', 'Mobile', width: 15),
          AgReportColumn('email', 'Email', width: 28),
        ],
      ),
      AgReportConfig(
        id: 'board-of-directors',
        title: 'Board of Directors',
        fileName: 'MyClubs_BOD',
        icon: Icons.groups_outlined,
        color: AppColors.accentBlue,
        yearScoped: true,
        columns: [
          AgReportColumn('clubName', 'Club', width: 35),
          AgReportColumn('yearLabel', 'Year', width: 12),
          AgReportColumn('designation', 'Designation', width: 25),
          AgReportColumn('memberName', 'Name', width: 28),
          AgReportColumn('mobile', 'Mobile', width: 15),
          AgReportColumn('email', 'Email', width: 28),
        ],
      ),
    ],
  ),
  AgReportSection(
    id: 'members',
    title: 'Members',
    icon: Icons.people_outline,
    items: [
      AgReportConfig(
        id: 'club-members',
        title: 'Members (basic)',
        fileName: 'MyClubs_Members',
        icon: Icons.person_outline,
        color: AppColors.error,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('memberName', 'Member Name', width: 28),
          AgReportColumn('rotaryId', 'Rotary ID', width: 14),
          AgReportColumn('mobile', 'Mobile', width: 15),
          AgReportColumn('email', 'Email', width: 28),
          AgReportColumn('gender', 'Gender', width: 10),
          AgReportColumn('birthDate', 'DOB', width: 14),
          AgReportColumn('anniversaryDate', 'Anniversary', width: 14),
          AgReportColumn('bloodGroup', 'Blood', width: 10),
          AgReportColumn('joinedDate', 'Joined', width: 14),
        ],
      ),
      AgReportConfig(
        id: 'members-full-details',
        title: 'Members: Full Details',
        fileName: 'MyClubs_Members_Full',
        icon: Icons.badge_outlined,
        color: AppColors.error,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('memberName', 'Name', width: 28),
          AgReportColumn('rotaryId', 'Rotary ID', width: 14),
          AgReportColumn('mobile', 'Mobile', width: 15),
          AgReportColumn('secondaryMobile', 'Sec. Mobile', width: 15),
          AgReportColumn('email', 'Email', width: 28),
          AgReportColumn('gender', 'Gender', width: 10),
          AgReportColumn('birthDate', 'DOB', width: 14),
          AgReportColumn('anniversaryDate', 'Anniv.', width: 14),
          AgReportColumn('bloodGroup', 'Blood', width: 8),
          AgReportColumn('primaryLanguage', 'Lang.', width: 12),
          AgReportColumn('donorRecognition', 'Donor Recog.', width: 18),
          AgReportColumn('facebook', 'Facebook', width: 24),
          AgReportColumn('instagram', 'Instagram', width: 24),
          AgReportColumn('linkedIn', 'LinkedIn', width: 24),
          AgReportColumn('twitter', 'Twitter', width: 24),
          AgReportColumn('youtube', 'Youtube', width: 24),
          AgReportColumn('website', 'Website', width: 24),
        ],
      ),
      AgReportConfig(
        id: 'members-contact-summary',
        title: 'Members: Contact Summary',
        fileName: 'MyClubs_Contact_Summary',
        icon: Icons.contact_phone_outlined,
        color: AppColors.chart5,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('memberName', 'Name', width: 28),
          AgReportColumn('primaryMobile', 'Primary Mobile', width: 16),
          AgReportColumn('secondaryMobile', 'Secondary Mobile', width: 16),
          AgReportColumn('email', 'Email', width: 30),
        ],
      ),
      AgReportConfig(
        id: 'members-addresses',
        title: 'Members: Addresses',
        fileName: 'MyClubs_Addresses',
        icon: Icons.home_outlined,
        color: AppColors.chart5,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('memberName', 'Name', width: 28),
          AgReportColumn('addressType', 'Type', width: 14),
          AgReportColumn('address', 'Address', width: 40),
          AgReportColumn('city', 'City', width: 16),
          AgReportColumn('state', 'State', width: 16),
          AgReportColumn('pinCode', 'Pincode', width: 10),
          AgReportColumn('phoneNumber', 'Phone', width: 14),
          AgReportColumn('businessName', 'Business Name', width: 24),
          AgReportColumn('designation', 'Designation', width: 20),
          AgReportColumn('classification', 'Classification', width: 24),
          AgReportColumn('keywords', 'Keywords', width: 24),
        ],
      ),
      AgReportConfig(
        id: 'mobile-app-users',
        title: 'Mobile App Users',
        fileName: 'MyClubs_Mobile_App_Users',
        icon: Icons.phone_iphone,
        color: AppColors.accentBlue,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('memberName', 'Name', width: 28),
          AgReportColumn('mobile', 'Mobile', width: 15),
          AgReportColumn('email', 'Email', width: 28),
          AgReportColumn('lastLogin', 'Last Login', width: 20),
        ],
      ),
      AgReportConfig(
        id: 'potential-members',
        title: 'Potential Members',
        fileName: 'MyClubs_Potential_Members',
        icon: Icons.person_add_alt,
        color: AppColors.accentBlue,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('memberName', 'Name', width: 28),
          AgReportColumn('mobile', 'Mobile', width: 15),
          AgReportColumn('email', 'Email', width: 28),
          AgReportColumn('classification', 'Classification', width: 24),
          AgReportColumn('referredBy', 'Referred By', width: 24),
          AgReportColumn('status', 'Status', width: 14),
          AgReportColumn('addedOn', 'Added On', width: 18),
        ],
      ),
    ],
  ),
  AgReportSection(
    id: 'activity',
    title: 'Activity',
    icon: Icons.bolt,
    items: [
      AgReportConfig(
        id: 'club-announcements',
        title: 'Announcements',
        fileName: 'MyClubs_Announcements',
        icon: Icons.campaign_outlined,
        color: AppColors.warningDark,
        yearScoped: true,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('yearLabel', 'Year', width: 12),
          AgReportColumn('title', 'Title', width: 36),
          AgReportColumn('description', 'Description', width: 50),
          AgReportColumn('publishedDate', 'Published', width: 16),
          AgReportColumn('expiryDate', 'Expiry', width: 16),
        ],
      ),
      AgReportConfig(
        id: 'club-upcoming-events',
        title: 'Upcoming Events',
        fileName: 'MyClubs_Upcoming_Events',
        icon: Icons.event_outlined,
        color: AppColors.accentBlue,
        yearScoped: true,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('yearLabel', 'Year', width: 12),
          AgReportColumn('title', 'Title', width: 36),
          AgReportColumn('description', 'Description', width: 50),
          AgReportColumn('eventDate', 'Date', width: 14),
          AgReportColumn('eventTime', 'Time', width: 12),
          AgReportColumn('location', 'Location', width: 30),
        ],
      ),
      AgReportConfig(
        id: 'club-attendance',
        title: 'Attendance',
        fileName: 'MyClubs_Attendance',
        icon: Icons.check_box_outlined,
        color: AppColors.accentBlue,
        yearScoped: true,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('yearLabel', 'Year', width: 12),
          AgReportColumn('meetingDate', 'Meeting Date', width: 16),
          AgReportColumn('meetingType', 'Type', width: 16),
          AgReportColumn('meetingTopic', 'Topic', width: 36),
          AgReportColumn('totalMembers', 'Total', width: 10),
          AgReportColumn('presentMembers', 'Present', width: 10),
        ],
      ),
      AgReportConfig(
        id: 'club-documents',
        title: 'Documents',
        fileName: 'MyClubs_Documents',
        icon: Icons.description_outlined,
        color: AppColors.accentBlue,
        yearScoped: true,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('yearLabel', 'Year', width: 12),
          AgReportColumn('title', 'Title', width: 36),
          AgReportColumn('description', 'Description', width: 40),
          AgReportColumn('documentDate', 'Date', width: 16),
          AgReportColumn('documentUrl', 'URL', width: 50, hyperlink: true),
        ],
      ),
      AgReportConfig(
        id: 'newsletters',
        title: 'Newsletters',
        fileName: 'MyClubs_Newsletters',
        icon: Icons.newspaper_outlined,
        color: AppColors.error,
        yearScoped: true,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('yearLabel', 'Year', width: 12),
          AgReportColumn('title', 'Title', width: 40),
          AgReportColumn('publishedDate', 'Published', width: 16),
        ],
      ),
      AgReportConfig(
        id: 'club-monthly-reports',
        title: 'Monthly Reports',
        fileName: 'MyClubs_Monthly_Reports',
        icon: Icons.calendar_month_outlined,
        color: AppColors.accentBlue,
        yearScoped: true,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('yearLabel', 'Year', width: 12),
          AgReportColumn('reportMonth', 'Month', width: 14),
          AgReportColumn('isSubmitted', 'Submitted?', width: 12),
          AgReportColumn('submittedDate', 'Submitted On', width: 18),
        ],
      ),
      AgReportConfig(
        id: 'rotary-projects',
        title: 'Rotary Projects',
        fileName: 'MyClubs_Projects',
        icon: Icons.volunteer_activism_outlined,
        color: AppColors.success,
        yearScoped: true,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('yearLabel', 'Year', width: 12),
          AgReportColumn('moduleName', 'Module', width: 18),
          AgReportColumn('title', 'Title', width: 36),
          AgReportColumn('description', 'Description', width: 50),
          AgReportColumn('location', 'Location', width: 24),
          AgReportColumn('projectType', 'Type', width: 16),
          AgReportColumn('startDate', 'Start', width: 14),
          AgReportColumn('endDate', 'End', width: 14),
          AgReportColumn('totalBeneficiaries', 'Beneficiaries', width: 14),
          AgReportColumn('totalVolunteers', 'Volunteers', width: 12),
          AgReportColumn('totalCost', 'Cost', width: 14),
        ],
      ),
      AgReportConfig(
        id: 'trf-contributions',
        title: 'TRF Contributions',
        fileName: 'MyClubs_TRF',
        icon: Icons.savings_outlined,
        color: AppColors.goldLight,
        yearScoped: true,
        columns: [
          AgReportColumn('clubName', 'Club', width: 28),
          AgReportColumn('yearLabel', 'Year', width: 12),
          AgReportColumn('memberName', 'Member', width: 28),
          AgReportColumn('fundName', 'Fund', width: 24),
          AgReportColumn('amount', 'Amount', width: 12),
          AgReportColumn('recognition', 'Recognition', width: 18),
          AgReportColumn('contributionDate', 'Date', width: 14),
          AgReportColumn('remarks', 'Remarks', width: 30),
        ],
      ),
    ],
  ),
];
