=== ROW Connector ===
Requires at least: 5.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Shows a Rotary club's or district's events, officers, news, projects, directory and public documents from ROW.

== Setup ==

1. In ROW web admin open the club (or district), Website Data, WordPress connector, and create a website API key.
   Copy it: ROW shows it once.
2. In WordPress: Settings, ROW Connector. Enter the ROW API address and the key, save, then press Test connection.
3. Put shortcodes on any page.

== Shortcodes ==

[row_events limit="6"]    upcoming events
[row_officers]            club board, or district governor and committee, for the current Rotary year
[row_news limit="6"]      latest newsletters
[row_projects limit="6"]  service projects of the current Rotary year
[row_directory]           club key: members (name, photo, classification; never email or phone);
                          district key: the district's clubs and meeting details
[row_documents]           documents the admin marked "Public on website" in ROW

`limit` is 1 to 50.

== Notes ==

* The key is read-only and tied to one club or district. Revoke it in ROW at any time.
* Responses are cached with WordPress transients (5 to 1440 minutes, set on the settings page). If ROW cannot be
  reached, the last good copy (up to a week old) is shown.
* No external libraries. Deleting the plugin removes its settings and cache.
