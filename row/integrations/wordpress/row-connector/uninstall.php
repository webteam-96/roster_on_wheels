<?php
// Removes the saved settings (including the API key) and every cached response when the plugin is deleted.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'row_connector_settings' );

global $wpdb;
$row_like  = $wpdb->esc_like( '_transient_row_conn_' ) . '%';
$row_tlike = $wpdb->esc_like( '_transient_timeout_row_conn_' ) . '%';
$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s", $row_like, $row_tlike ) );
