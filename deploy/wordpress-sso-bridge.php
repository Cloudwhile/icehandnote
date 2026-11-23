<?php
/**
 * Plugin Name: IceHandNote WordPress SSO Bridge
 * Description: Passes signed WordPress user identity (ID, display name, avatar, email, and roles) via HMAC-SHA256 to a self-hosted IceHandNote instance.
 * Version: 1.1.0
 *
 * Installation:
 * 1. Copy this file to `wp-content/mu-plugins/wordpress-sso-bridge.php`.
 * 2. Configure the shared secret and target site URL in `wp-config.php`:
 *    define('ICEHANDNOTE_URL', 'https://notes.example.com');
 *    define('ICEHANDNOTE_SSO_SECRET', 'replace-with-at-least-32-random-chars');
 *    define('ICEHANDNOTE_SSO_PARAM', 'sso_login'); // optional; matches BLOG_SSO_QUERY_PARAM / Settings
 *    define('ICEHANDNOTE_DEFAULT_LOCALE', 'zh-CN'); // optional default landing locale
 * 3. Link users to: `https://blog.example.com/?sso_login=1`
 */

if (!defined('ABSPATH')) {
    exit;
}

function icehandnote_base64url_encode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

add_action('template_redirect', function () {
    $param = defined('ICEHANDNOTE_SSO_PARAM') ? ICEHANDNOTE_SSO_PARAM : 'sso_login';
    $triggered_param = null;
    if (isset($_GET[$param])) {
        $triggered_param = $param;
    } elseif (isset($_GET['icetowne_sso_go'])) {
        // Legacy fallback for existing deployments
        $triggered_param = 'icetowne_sso_go';
    }
    if ($triggered_param === null) {
        return;
    }

    $note_base = defined('ICEHANDNOTE_URL')
        ? rtrim(ICEHANDNOTE_URL, '/')
        : (defined('ICETOWNE_STEP_URL') ? rtrim(ICETOWNE_STEP_URL, '/') : 'http://localhost:5173');
    $secret = defined('ICEHANDNOTE_SSO_SECRET')
        ? ICEHANDNOTE_SSO_SECRET
        : (defined('ICETOWNE_SSO_SECRET') ? ICETOWNE_SSO_SECRET : '');

    if (empty($secret) || strlen($secret) < 32) {
        wp_die('IceHandNote SSO Bridge: ICEHANDNOTE_SSO_SECRET must be configured in wp-config.php with at least 32 characters.');
    }

    if (!is_user_logged_in()) {
        $current_url = home_url(add_query_arg($triggered_param, '1'));
        wp_safe_redirect(wp_login_url($current_url));
        exit;
    }

    $user = wp_get_current_user();
    $now  = time();

    $payload = [
        'wp_user_id'   => (int) $user->ID,
        'username'     => (string) $user->user_login,
        'display_name' => (string) ($user->display_name ?: $user->user_login),
        'email'        => (string) $user->user_email,
        'avatar_url'   => (string) get_avatar_url($user->ID, ['size' => 128]),
        'wp_roles'     => array_values((array) $user->roles),
        'blog_origin'  => home_url(),
        'jti'          => bin2hex(random_bytes(16)),
        'iat'          => $now,
        'exp'          => $now + 300, // 5-minute replay-safe expiry
    ];

    $payload_b64 = icehandnote_base64url_encode(wp_json_encode($payload));
    $signature   = hash_hmac('sha256', $payload_b64, $secret);
    $sso_token   = $payload_b64 . '.' . $signature;

    $default_locale = defined('ICEHANDNOTE_DEFAULT_LOCALE') ? ICEHANDNOTE_DEFAULT_LOCALE : 'zh-CN';
    $default_path = '/' . ltrim($default_locale, '/');
    $return_path = isset($_GET['return_to']) ? sanitize_text_field(wp_unslash($_GET['return_to'])) : $default_path;
    if (
        !str_starts_with($return_path, '/')
        || str_starts_with($return_path, '//')
        || str_contains($return_path, '\\')
        || preg_match('/[\x00-\x1F\x7F]/', $return_path)
    ) {
        $return_path = $default_path;
    }

    $target = $note_base . $return_path . (str_contains($return_path, '?') ? '&' : '?') . 'sso_token=' . rawurlencode($sso_token);
    wp_redirect($target);
    exit;
});
