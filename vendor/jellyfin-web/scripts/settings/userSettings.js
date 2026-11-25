// lite-tv replacement for jellyfin-web's src/scripts/settings/userSettings.js (GPL-2.0, see ../../LICENSE).
// The upstream module pulls in jellyfin-web's whole API/query stack. browserDeviceProfile.js only reads the
// three settings below. Upstream stores all three on the device only (enableOnServer = false), via
// appSettings, so a device that never changed them gets these exact defaults. Keep in sync with upstream.
import browser from '../browser';
import appSettings from './appSettings';
import { toBoolean } from '../../utils/string.ts';

export function allowedAudioChannels() {
    return appSettings.get('allowedAudioChannels') || '-1';
}

export function preferFmp4HlsContainer() {
    // Upstream: enabled by default only for the platforms that play fMP4 for sure.
    return toBoolean(appSettings.get('preferFmp4HlsContainer'), browser.safari || browser.firefox || browser.chrome || browser.edgeChromium);
}

export function limitSegmentLength() {
    return toBoolean(appSettings.get('limitSegmentLength'), false);
}
