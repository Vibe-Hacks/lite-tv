// Builds the Jellyfin device profile on the TV with jellyfin-web's own code (vendor/jellyfin-web, GPL-2.0),
// so lite-tv asks Jellyfin for exactly what the official Jellyfin web client / webOS app would ask for.
// Bundled to public/jf-profile.js by profile/build.js.
import getDeviceProfile from '../vendor/jellyfin-web/scripts/browserDeviceProfile';
import browser from '../vendor/jellyfin-web/scripts/browser';

window.LiteTvProfile = {
    /**
     * @param {object} deviceInfo webOS deviceInfo ({ dolbyAtmos, dolbyVision, hdr10 }) from the launcher app, or null
     * @returns {object} DeviceProfile
     */
    build: function (deviceInfo) {
        // Inside a webOS app, the official Jellyfin app (jellyfin-webos, frontend/js/webOS.js) calls the
        // profile builder with these options. Anywhere else, jellyfin-web calls it with none.
        const inWebOsApp = !!(window.PalmSystem && browser.web0s);
        const options = inWebOsApp ? {
            enableMkvProgressive: false,
            enableSsaRender: true,
            supportsDolbyAtmos: deviceInfo ? deviceInfo.dolbyAtmos : null,
            supportsDolbyVision: deviceInfo ? deviceInfo.dolbyVision : null,
            supportsHdr10: deviceInfo ? deviceInfo.hdr10 : null
        } : {};
        return getDeviceProfile(options);
    },
    browser: browser
};
