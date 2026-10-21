import 'package:flutter/material.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';

/// A single club Website-Data management module.
///
/// This is the ONE source of truth for the website-data tiles, shared by:
///   • the normal-dashboard "Website Data" hub grid (`ClubWebsiteDataHubScreen`), and
///   • the overview "My Club Website" tab's management grid (`club_website_tab.dart`).
/// Add a module here (or reorder) and both grids update together — they can no
/// longer drift (which is how "Logos" ended up on one grid but not the other).
class WebsiteDataModule {
  final String key;
  final String label;
  final IconData icon;
  final Color color;

  /// Sub-path segment under `/clubs/{id}/website-data/` (e.g. `banners`).
  final String route;

  const WebsiteDataModule({
    required this.key,
    required this.label,
    required this.icon,
    required this.color,
    required this.route,
  });

  String pathFor(int clubId) => '/clubs/$clubId/website-data/$route';
}

/// The canonical club website-data modules, in display order (both grids use this).
const List<WebsiteDataModule> kClubWebsiteDataModules = [
  WebsiteDataModule(
      key: 'banners',
      label: 'Banner Photos',
      icon: Icons.image_outlined,
      color: AppColors.accentBlue,
      route: 'banners'),
  WebsiteDataModule(
      key: 'advertisements',
      label: 'Advertisement Area',
      icon: Icons.campaign_outlined,
      color: AppColors.warningDark,
      route: 'advertisements'),
  WebsiteDataModule(
      key: 'social_media_links',
      label: 'Social Media Links',
      icon: Icons.share_outlined,
      color: AppColors.accentBlue,
      route: 'social-media-links'),
  WebsiteDataModule(
      key: 'logos',
      label: 'Logos',
      icon: Icons.branding_watermark_outlined,
      color: AppColors.accentBlue,
      route: 'logos'),
  WebsiteDataModule(
      key: 'menu_list',
      label: 'Menu List',
      icon: Icons.list_alt_outlined,
      color: AppColors.errorDark,
      route: 'menu-list'),
  WebsiteDataModule(
      key: 'theme',
      label: 'Change Theme',
      icon: Icons.palette_outlined,
      color: AppColors.accentBlue,
      route: 'theme'),
  WebsiteDataModule(
      key: 'contact_details',
      label: 'Contact Details',
      icon: Icons.contact_phone_outlined,
      color: AppColors.accentBlue,
      route: 'contact-details'),
  WebsiteDataModule(
      key: 'about',
      label: 'About',
      icon: Icons.info_outline,
      color: AppColors.success,
      route: 'about'),
];
