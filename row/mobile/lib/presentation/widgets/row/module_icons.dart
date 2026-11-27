import 'package:flutter/material.dart';

/// Icon of a dashboard module, by its key, when the module has no uploaded icon.
IconData moduleIcon(String moduleKey) {
  final key = moduleKey.toLowerCase().replaceAll(RegExp('[ _-]'), '');
  // First match wins, so the narrower words come first.
  for (final (word, icon) in const [
    ('directory', Icons.people_outline),
    ('bod', Icons.groups_2_outlined),
    ('board', Icons.groups_2_outlined),
    ('president', Icons.military_tech_outlined),
    ('committee', Icons.diversity_3_outlined),
    ('subgroup', Icons.group_work_outlined),
    ('network', Icons.hub_outlined),
    ('eventlink', Icons.add_link_rounded),
    ('paymentlink', Icons.add_link_rounded),
    ('calendar', Icons.calendar_month_outlined),
    ('event', Icons.event_outlined),
    ('announcement', Icons.campaign_outlined),
    ('greeting', Icons.cake_outlined),
    ('email', Icons.mail_outline_rounded),
    ('market', Icons.storefront_outlined),
    ('clubservice', Icons.handshake_outlined),
    ('community', Icons.volunteer_activism_outlined),
    ('vocational', Icons.work_outline),
    ('generation', Icons.school_outlined),
    ('international', Icons.public_outlined),
    ('image', Icons.image_outlined),
    ('newsletter', Icons.newspaper_outlined),
    ('document', Icons.folder_outlined),
    ('admin', Icons.admin_panel_settings_outlined),
    ('website', Icons.language_rounded),
    ('attendance', Icons.fact_check_outlined),
    ('link', Icons.link_outlined),
    ('citation', Icons.emoji_events_outlined),
    ('award', Icons.emoji_events_outlined),
    ('ocv', Icons.how_to_reg_outlined),
    ('trf', Icons.savings_outlined),
    ('goal', Icons.flag_outlined),
    ('dues', Icons.payments_outlined),
    ('wallet', Icons.account_balance_wallet_outlined),
    ('project', Icons.construction_outlined),
    ('clubs', Icons.location_city_outlined),
    ('report', Icons.bar_chart_rounded),
    ('cmr', Icons.bar_chart_rounded),
  ]) {
    if (key.contains(word)) return icon;
  }
  return key == 'ag' ? Icons.supervisor_account_outlined : Icons.grid_view_outlined;
}
