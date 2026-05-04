// Metro bundler config — extends Expo's default with Sentry's serializer
// so source maps are generated and uploaded to Sentry during EAS builds.
//
// The Sentry serializer wraps Expo's default; do not bypass it. If you ever
// need to add a custom serializer, chain it through Sentry's wrapper, not
// alongside.
//
// EAS picks up SENTRY_AUTH_TOKEN from the encrypted env (set via
// `eas env:create`) and uses it to upload source maps post-build.
const { getDefaultConfig } = require("expo/metro-config");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname, getDefaultConfig(__dirname));

module.exports = config;
