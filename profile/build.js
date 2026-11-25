// Builds public/jf-profile.js: jellyfin-web's device-profile builder, bundled and compiled down to ES5 for
// old TV browsers (Chrome 38), with only the core-js polyfills it actually uses.
//
//   cd profile && npm install && node build.js
//
// The output is committed, so running lite-tv itself needs no npm packages.
'use strict';
const path = require('path'), fs = require('fs');
const esbuild = require('esbuild');
const babel = require('@babel/core');

const root = path.join(__dirname, '..');
const vendor = path.join(root, 'vendor', 'jellyfin-web');
const out = path.join(root, 'public', 'jf-profile.js');

(async () => {
  // 1. Bundle the modern sources (ESM + TypeScript). jellyfin-web imports some modules by absolute
  //    alias ('scripts/browser'), which maps to vendor/jellyfin-web/scripts.
  const step1 = await esbuild.build({
    entryPoints: [path.join(__dirname, 'entry.js')], bundle: true, write: false, format: 'iife', target: 'es2017',
    alias: { scripts: path.join(vendor, 'scripts') }, logLevel: 'warning',
  });

  // 2. Compile to ES5 for Chrome 38 and inject the core-js polyfills the code uses.
  const step2 = await babel.transformAsync(step1.outputFiles[0].text, {
    babelrc: false, configFile: false, sourceType: 'unambiguous',
    presets: [[require.resolve('@babel/preset-env'), { targets: { chrome: '38' }, useBuiltIns: 'usage', corejs: '3.38', modules: false }]],
  });

  // 3. Bundle the injected core-js imports and minify (input is now ES5, so target es5 is safe).
  const step3 = await esbuild.build({
    stdin: { contents: step2.code, resolveDir: __dirname, sourcefile: 'jf-profile.js' },
    bundle: true, write: false, format: 'iife', target: 'es5', minify: true, logLevel: 'warning',
  });

  const banner = '/* lite-tv jf-profile.js: Jellyfin device profile builder from jellyfin-web (GPL-2.0-or-later).\n' +
    ' * Source: vendor/jellyfin-web (see SOURCE_COMMIT) and profile/entry.js. Built by profile/build.js. */\n';
  fs.writeFileSync(out, banner + step3.outputFiles[0].text);
  console.log(`wrote ${path.relative(root, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
})().catch(e => { console.error(e); process.exit(1); });
