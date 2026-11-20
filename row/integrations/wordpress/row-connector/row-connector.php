<?php
/**
 * Plugin Name:       ROW Connector
 * Description:       Shows your club or district's events, officers, news, projects, directory and public documents from ROW (Roster on Wheels) with shortcodes.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            ROW
 * License:           GPL-2.0-or-later
 * Text Domain:       row-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ROW_CONNECTOR_VERSION', '1.0.0' );
define( 'ROW_CONNECTOR_OPTION', 'row_connector_settings' );
define( 'ROW_CONNECTOR_CACHE_PREFIX', 'row_conn_' );

/* -------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------- */

function row_connector_settings() {
	$s = get_option( ROW_CONNECTOR_OPTION, array() );
	return wp_parse_args(
		is_array( $s ) ? $s : array(),
		array(
			'api_base'  => '',
			'api_key'   => '',
			'cache_min' => 15,
		)
	);
}

function row_connector_sanitize( $input ) {
	$old = row_connector_settings();
	$out = array();

	$base = isset( $input['api_base'] ) ? esc_url_raw( trim( (string) $input['api_base'] ), array( 'https', 'http' ) ) : '';
	$out['api_base'] = untrailingslashit( $base );

	// The key field is left blank on the form so the saved key never goes back to the browser; blank keeps it.
	$key = isset( $input['api_key'] ) ? trim( (string) $input['api_key'] ) : '';
	if ( '' === $key ) {
		$out['api_key'] = $old['api_key'];
	} elseif ( preg_match( '/^rowk_[A-Za-z0-9_-]{25,75}$/', $key ) ) {
		$out['api_key'] = $key;
	} else {
		$out['api_key'] = $old['api_key'];
		add_settings_error( ROW_CONNECTOR_OPTION, 'row_key', __( 'That does not look like a ROW website API key. The saved key was kept.', 'row-connector' ) );
	}

	$min              = isset( $input['cache_min'] ) ? absint( $input['cache_min'] ) : 15;
	$out['cache_min'] = max( 5, min( 1440, $min ) );

	row_connector_flush_cache();
	return $out;
}

add_action(
	'admin_init',
	function () {
		register_setting(
			'row_connector',
			ROW_CONNECTOR_OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => 'row_connector_sanitize',
				'default'           => array(),
			)
		);
	}
);

add_action(
	'admin_menu',
	function () {
		add_options_page(
			__( 'ROW Connector', 'row-connector' ),
			__( 'ROW Connector', 'row-connector' ),
			'manage_options',
			'row-connector',
			'row_connector_settings_page'
		);
	}
);

function row_connector_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$s      = row_connector_settings();
	$status = null;
	if ( isset( $_GET['row_test'] ) && check_admin_referer( 'row_connector_test' ) ) {
		$status = row_connector_fetch( 'site', array(), false );
	}
	?>
	<div class="wrap">
		<h1><?php echo esc_html__( 'ROW Connector', 'row-connector' ); ?></h1>
		<p><?php echo esc_html__( 'Create a website API key in ROW (Website Data, WordPress connector), then paste it here with the ROW API address.', 'row-connector' ); ?></p>
		<?php settings_errors( ROW_CONNECTOR_OPTION ); ?>
		<form method="post" action="options.php">
			<?php settings_fields( 'row_connector' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="row_api_base"><?php echo esc_html__( 'ROW API address', 'row-connector' ); ?></label></th>
					<td><input type="url" class="regular-text" id="row_api_base" name="<?php echo esc_attr( ROW_CONNECTOR_OPTION ); ?>[api_base]" value="<?php echo esc_attr( $s['api_base'] ); ?>" placeholder="https://api.example.org" required></td>
				</tr>
				<tr>
					<th scope="row"><label for="row_api_key"><?php echo esc_html__( 'Website API key', 'row-connector' ); ?></label></th>
					<td>
						<input type="password" class="regular-text" id="row_api_key" name="<?php echo esc_attr( ROW_CONNECTOR_OPTION ); ?>[api_key]" value="" autocomplete="off">
						<p class="description">
							<?php
							echo esc_html(
								'' === $s['api_key']
									? __( 'No key saved yet.', 'row-connector' )
									/* translators: %s: first characters of the saved key */
									: sprintf( __( 'Saved key starts with %s. Leave blank to keep it.', 'row-connector' ), substr( $s['api_key'], 0, 12 ) )
							);
							?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="row_cache_min"><?php echo esc_html__( 'Refresh every (minutes)', 'row-connector' ); ?></label></th>
					<td><input type="number" min="5" max="1440" id="row_cache_min" name="<?php echo esc_attr( ROW_CONNECTOR_OPTION ); ?>[cache_min]" value="<?php echo esc_attr( (string) $s['cache_min'] ); ?>"></td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<h2><?php echo esc_html__( 'Connection', 'row-connector' ); ?></h2>
		<p><a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'options-general.php?page=row-connector&row_test=1' ), 'row_connector_test' ) ); ?>"><?php echo esc_html__( 'Test connection', 'row-connector' ); ?></a></p>
		<?php if ( null !== $status ) : ?>
			<?php if ( is_wp_error( $status ) ) : ?>
				<div class="notice notice-error inline"><p><?php echo esc_html( $status->get_error_message() ); ?></p></div>
			<?php else : ?>
				<div class="notice notice-success inline"><p>
					<?php
					/* translators: 1: club or district, 2: ROW id */
					echo esc_html( sprintf( __( 'Connected to %1$s %2$d.', 'row-connector' ), (string) $status['scope'], (int) $status['id'] ) );
					?>
				</p></div>
			<?php endif; ?>
		<?php endif; ?>

		<h2><?php echo esc_html__( 'Shortcodes', 'row-connector' ); ?></h2>
		<ul>
			<li><code>[row_events limit="6"]</code> <?php echo esc_html__( 'Upcoming events', 'row-connector' ); ?></li>
			<li><code>[row_officers]</code> <?php echo esc_html__( 'Board or district team for the current Rotary year', 'row-connector' ); ?></li>
			<li><code>[row_news limit="6"]</code> <?php echo esc_html__( 'Latest newsletters', 'row-connector' ); ?></li>
			<li><code>[row_projects limit="6"]</code> <?php echo esc_html__( 'Service projects this Rotary year', 'row-connector' ); ?></li>
			<li><code>[row_directory]</code> <?php echo esc_html__( 'Members (club key) or clubs (district key)', 'row-connector' ); ?></li>
			<li><code>[row_documents]</code> <?php echo esc_html__( 'Documents marked public in ROW', 'row-connector' ); ?></li>
		</ul>
	</div>
	<?php
}

/* -------------------------------------------------------------------------
 * API client with transient cache
 * ---------------------------------------------------------------------- */

/**
 * GET one connector endpoint. Fresh copy cached for the chosen minutes; on failure the last good copy (kept a week)
 * is used, so a ROW outage never blanks the site.
 *
 * @return array|WP_Error decoded JSON
 */
function row_connector_fetch( $endpoint, $args = array(), $use_cache = true ) {
	$s = row_connector_settings();
	if ( '' === $s['api_base'] || '' === $s['api_key'] ) {
		return new WP_Error( 'row_not_configured', __( 'ROW Connector is not set up yet.', 'row-connector' ) );
	}
	$url       = add_query_arg( array_map( 'rawurlencode', $args ), $s['api_base'] . '/api/public/connector/v1/' . $endpoint );
	$cache_key = ROW_CONNECTOR_CACHE_PREFIX . md5( $url . '|' . $s['api_key'] );

	if ( $use_cache ) {
		$fresh = get_transient( $cache_key );
		if ( false !== $fresh ) {
			return $fresh;
		}
	}

	$response = wp_remote_get(
		$url,
		array(
			'timeout' => 8,
			'headers' => array(
				'X-ROW-Key' => $s['api_key'],
				'Accept'    => 'application/json',
			),
		)
	);

	$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$data = 200 === $code ? json_decode( wp_remote_retrieve_body( $response ), true ) : null;

	if ( ! is_array( $data ) ) {
		$stale = get_transient( $cache_key . '_s' );
		if ( $use_cache && false !== $stale ) {
			set_transient( $cache_key, $stale, MINUTE_IN_SECONDS ); // retry in a minute, not on every page view
			return $stale;
		}
		if ( 401 === $code ) {
			return new WP_Error( 'row_bad_key', __( 'ROW refused the website API key. It may have been revoked.', 'row-connector' ) );
		}
		if ( 429 === $code ) {
			return new WP_Error( 'row_rate_limited', __( 'ROW is busy. Try again in a minute.', 'row-connector' ) );
		}
		return new WP_Error( 'row_unreachable', __( 'Could not reach ROW.', 'row-connector' ) );
	}

	set_transient( $cache_key, $data, (int) $s['cache_min'] * MINUTE_IN_SECONDS );
	set_transient( $cache_key . '_s', $data, WEEK_IN_SECONDS );
	return $data;
}

function row_connector_flush_cache() {
	global $wpdb;
	$like = $wpdb->esc_like( '_transient_' . ROW_CONNECTOR_CACHE_PREFIX ) . '%';
	$tlike = $wpdb->esc_like( '_transient_timeout_' . ROW_CONNECTOR_CACHE_PREFIX ) . '%';
	$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s", $like, $tlike ) );
}

/** ROW returns file and photo paths relative to its own host. */
function row_connector_asset_url( $path ) {
	if ( empty( $path ) || ! is_string( $path ) ) {
		return '';
	}
	if ( preg_match( '#^https?://#i', $path ) ) {
		return $path;
	}
	$s = row_connector_settings();
	$p = wp_parse_url( $s['api_base'] );
	if ( empty( $p['scheme'] ) || empty( $p['host'] ) ) {
		return '';
	}
	$origin = $p['scheme'] . '://' . $p['host'] . ( isset( $p['port'] ) ? ':' . $p['port'] : '' );
	return $origin . '/' . ltrim( $path, '/' );
}

function row_connector_date( $iso, $with_time = false ) {
	$ts = $iso ? strtotime( $iso . ( preg_match( '/(Z|[+-]\d\d:?\d\d)$/', $iso ) ? '' : 'Z' ) ) : false;
	if ( ! $ts ) {
		return '';
	}
	$format = get_option( 'date_format' ) . ( $with_time ? ' ' . get_option( 'time_format' ) : '' );
	return wp_date( $format, $ts ); // ROW stores UTC; shown in the site's time zone
}

function row_connector_get( $row, $key ) {
	return isset( $row[ $key ] ) && is_scalar( $row[ $key ] ) ? (string) $row[ $key ] : '';
}

/** Error or empty state: visitors see a short line, editors also see why. */
function row_connector_notice( $error_or_text ) {
	$text = is_wp_error( $error_or_text )
		? ( current_user_can( 'edit_posts' ) ? $error_or_text->get_error_message() : __( 'This content is not available right now.', 'row-connector' ) )
		: $error_or_text;
	return '<p class="row-connector-empty">' . esc_html( $text ) . '</p>';
}

function row_connector_limit( $atts ) {
	$a = shortcode_atts( array( 'limit' => 6 ), $atts );
	return max( 1, min( 50, absint( $a['limit'] ) ) );
}

/* -------------------------------------------------------------------------
 * Shortcodes (every value is escaped on output)
 * ---------------------------------------------------------------------- */

function row_connector_events( $atts ) {
	$rows = row_connector_fetch( 'events', array( 'limit' => row_connector_limit( $atts ) ) );
	if ( is_wp_error( $rows ) ) {
		return row_connector_notice( $rows );
	}
	if ( ! $rows ) {
		return row_connector_notice( __( 'No upcoming events.', 'row-connector' ) );
	}
	$html = '<ul class="row-connector row-events">';
	foreach ( $rows as $e ) {
		$img  = row_connector_asset_url( row_connector_get( $e, 'imagePath' ) );
		$link = row_connector_get( $e, 'registrationLink' );
		$html .= '<li class="row-item">';
		if ( $img ) {
			$html .= '<img src="' . esc_url( $img ) . '" alt="" loading="lazy">';
		}
		$html .= '<h3>' . esc_html( row_connector_get( $e, 'title' ) ) . '</h3>';
		$html .= '<p class="row-meta">' . esc_html( row_connector_date( row_connector_get( $e, 'eventDate' ), true ) );
		if ( '' !== row_connector_get( $e, 'venue' ) ) {
			$html .= ' | ' . esc_html( row_connector_get( $e, 'venue' ) );
		}
		$html .= '</p>';
		if ( '' !== row_connector_get( $e, 'description' ) ) {
			$html .= '<p>' . esc_html( row_connector_get( $e, 'description' ) ) . '</p>';
		}
		if ( preg_match( '#^https?://#i', $link ) ) {
			$html .= '<p><a href="' . esc_url( $link ) . '" rel="noopener" target="_blank">' . esc_html__( 'Register', 'row-connector' ) . '</a></p>';
		}
		$html .= '</li>';
	}
	return $html . '</ul>';
}

function row_connector_officers() {
	$rows = row_connector_fetch( 'officers' );
	if ( is_wp_error( $rows ) ) {
		return row_connector_notice( $rows );
	}
	if ( ! $rows ) {
		return row_connector_notice( __( 'No officers listed for this Rotary year.', 'row-connector' ) );
	}
	$html = '<ul class="row-connector row-officers">';
	foreach ( $rows as $o ) {
		$photo = row_connector_asset_url( row_connector_get( $o, 'photoPath' ) );
		$html .= '<li class="row-item">';
		if ( $photo ) {
			$html .= '<img src="' . esc_url( $photo ) . '" alt="' . esc_attr( row_connector_get( $o, 'name' ) ) . '" loading="lazy">';
		}
		$html .= '<h3>' . esc_html( row_connector_get( $o, 'name' ) ) . '</h3>';
		$meta = array_filter( array( row_connector_get( $o, 'designation' ), row_connector_get( $o, 'group' ), row_connector_get( $o, 'clubName' ) ) );
		if ( $meta ) {
			$html .= '<p class="row-meta">' . esc_html( implode( ' | ', $meta ) ) . '</p>';
		}
		$html .= '</li>';
	}
	return $html . '</ul>';
}

function row_connector_news( $atts ) {
	$rows = row_connector_fetch( 'news', array( 'limit' => row_connector_limit( $atts ) ) );
	if ( is_wp_error( $rows ) ) {
		return row_connector_notice( $rows );
	}
	if ( ! $rows ) {
		return row_connector_notice( __( 'No news yet.', 'row-connector' ) );
	}
	$html = '<ul class="row-connector row-news">';
	foreach ( $rows as $n ) {
		$link = row_connector_get( $n, 'linkUrl' );
		$href = preg_match( '#^https?://#i', $link ) ? $link : row_connector_asset_url( row_connector_get( $n, 'filePath' ) );
		$title = esc_html( row_connector_get( $n, 'title' ) );
		$html .= '<li class="row-item"><h3>' . ( $href ? '<a href="' . esc_url( $href ) . '" rel="noopener" target="_blank">' . $title . '</a>' : $title ) . '</h3>';
		$html .= '<p class="row-meta">' . esc_html( row_connector_date( row_connector_get( $n, 'publishedAt' ) ) ) . '</p></li>';
	}
	return $html . '</ul>';
}

function row_connector_projects( $atts ) {
	$rows = row_connector_fetch( 'projects', array( 'limit' => row_connector_limit( $atts ) ) );
	if ( is_wp_error( $rows ) ) {
		return row_connector_notice( $rows );
	}
	if ( ! $rows ) {
		return row_connector_notice( __( 'No projects this Rotary year yet.', 'row-connector' ) );
	}
	$html = '<ul class="row-connector row-projects">';
	foreach ( $rows as $p ) {
		$photo = row_connector_asset_url( row_connector_get( $p, 'photoPath' ) );
		$html .= '<li class="row-item">';
		if ( $photo ) {
			$html .= '<img src="' . esc_url( $photo ) . '" alt="" loading="lazy">';
		}
		$html .= '<h3>' . esc_html( row_connector_get( $p, 'title' ) ) . '</h3>';
		$meta = array_filter( array( row_connector_date( row_connector_get( $p, 'projectDate' ) ), row_connector_get( $p, 'avenue' ), row_connector_get( $p, 'areaOfFocus' ), row_connector_get( $p, 'location' ) ) );
		if ( $meta ) {
			$html .= '<p class="row-meta">' . esc_html( implode( ' | ', $meta ) ) . '</p>';
		}
		if ( '' !== row_connector_get( $p, 'description' ) ) {
			$html .= '<p>' . esc_html( row_connector_get( $p, 'description' ) ) . '</p>';
		}
		$html .= '</li>';
	}
	return $html . '</ul>';
}

function row_connector_directory() {
	$data = row_connector_fetch( 'directory' );
	if ( is_wp_error( $data ) ) {
		return row_connector_notice( $data );
	}
	$items = isset( $data['items'] ) && is_array( $data['items'] ) ? $data['items'] : array();
	if ( ! $items ) {
		return row_connector_notice( __( 'The directory is empty.', 'row-connector' ) );
	}
	$clubs = isset( $data['kind'] ) && 'clubs' === $data['kind'];
	$html  = '<ul class="row-connector row-directory">';
	foreach ( $items as $r ) {
		$html .= '<li class="row-item">';
		if ( $clubs ) {
			$site  = row_connector_get( $r, 'website' );
			$html .= '<h3>' . esc_html( row_connector_get( $r, 'name' ) ) . '</h3>';
			$when  = trim( row_connector_get( $r, 'meetingDay' ) . ' ' . row_connector_get( $r, 'meetingFrom' ) );
			$meta  = array_filter( array( row_connector_get( $r, 'city' ), $when, row_connector_get( $r, 'meetingAddress' ) ) );
			if ( $meta ) {
				$html .= '<p class="row-meta">' . esc_html( implode( ' | ', $meta ) ) . '</p>';
			}
			if ( '' !== $site ) {
				$href  = preg_match( '#^https?://#i', $site ) ? $site : 'https://' . $site;
				$html .= '<p><a href="' . esc_url( $href ) . '" rel="noopener" target="_blank">' . esc_html( $site ) . '</a></p>';
			}
		} else {
			$photo = row_connector_asset_url( row_connector_get( $r, 'photoPath' ) );
			if ( $photo ) {
				$html .= '<img src="' . esc_url( $photo ) . '" alt="' . esc_attr( row_connector_get( $r, 'name' ) ) . '" loading="lazy">';
			}
			$html .= '<h3>' . esc_html( row_connector_get( $r, 'name' ) ) . '</h3>';
			if ( '' !== row_connector_get( $r, 'classification' ) ) {
				$html .= '<p class="row-meta">' . esc_html( row_connector_get( $r, 'classification' ) ) . '</p>';
			}
			// shortcut: no email or phone (ROW never sends them); adding them needs an explicit "public website" opt-in in ROW first.
		}
		$html .= '</li>';
	}
	return $html . '</ul>';
}

function row_connector_documents() {
	$rows = row_connector_fetch( 'documents' );
	if ( is_wp_error( $rows ) ) {
		return row_connector_notice( $rows );
	}
	if ( ! $rows ) {
		return row_connector_notice( __( 'No public documents.', 'row-connector' ) );
	}
	$html = '<ul class="row-connector row-documents">';
	foreach ( $rows as $d ) {
		$href  = row_connector_asset_url( row_connector_get( $d, 'filePath' ) );
		$title = esc_html( row_connector_get( $d, 'title' ) );
		$html .= '<li class="row-item">' . ( $href ? '<a href="' . esc_url( $href ) . '" rel="noopener" target="_blank">' . $title . '</a>' : $title );
		$html .= ' <span class="row-meta">' . esc_html( row_connector_date( row_connector_get( $d, 'publishedAt' ) ) ) . '</span></li>';
	}
	return $html . '</ul>';
}

add_action(
	'init',
	function () {
		add_shortcode( 'row_events', 'row_connector_events' );
		add_shortcode( 'row_officers', 'row_connector_officers' );
		add_shortcode( 'row_news', 'row_connector_news' );
		add_shortcode( 'row_projects', 'row_connector_projects' );
		add_shortcode( 'row_directory', 'row_connector_directory' );
		add_shortcode( 'row_documents', 'row_connector_documents' );
	}
);

// Minimal layout only; the theme supplies fonts and colours.
add_action(
	'wp_head',
	function () {
		echo '<style id="row-connector-css">.row-connector{list-style:none;margin:0;padding:0;display:grid;gap:1.25rem;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}.row-connector .row-item img{width:100%;height:auto;display:block;margin-bottom:.5rem}.row-connector h3{margin:0 0 .25rem;font-size:1.05em}.row-connector .row-meta{opacity:.75;font-size:.9em;margin:0 0 .25rem}.row-documents,.row-news{grid-template-columns:1fr}</style>' . "\n";
	}
);
