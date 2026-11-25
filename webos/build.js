// Builds the lite-tv launcher app (.ipk) for LG webOS TVs with your server's address baked in.
//
//   node webos/build.js http://192.168.1.10:6972
//
// Needs LG's webOS CLI for packaging:  npm install -g @webos-tools/cli   (provides `ares-package`)
// Output: webos/dist/io.github.vibe-hacks.litetv_<version>_all.ipk
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const url = (process.argv[2] || '').trim();
if (!/^https?:\/\/[^/]+/.test(url)) {
  console.error('Usage: node webos/build.js http://<lite-tv host>:<port>');
  process.exit(1);
}

const src = path.join(__dirname, 'app'), build = path.join(__dirname, 'build'), dist = path.join(__dirname, 'dist');
fs.rmSync(build, { recursive: true, force: true });
fs.mkdirSync(build, { recursive: true });
fs.mkdirSync(dist, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(build, f));

const index = path.join(build, 'index.html');
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace("'LITE_TV_URL'", `'${url.replace(/'/g, '')}'`));

// Find ares-package: $ARES_PACKAGE (a .js entry or an executable), a local/global @webos-tools/cli, or PATH.
function aresCommand() {
  const env = process.env.ARES_PACKAGE;
  if (env) return env.endsWith('.js') ? [process.execPath, [env]] : [env, []];
  for (const base of [process.cwd(), path.join(require('os').homedir(), 'AppData', 'Roaming', 'npm'), '/usr/local/lib', '/usr/lib']) {
    try { return [process.execPath, [require.resolve('@webos-tools/cli/bin/ares-package.js', { paths: [base, path.join(base, 'node_modules')] })]]; } catch {}
  }
  return [process.platform === 'win32' ? 'ares-package.cmd' : 'ares-package', []];
}
const [cmd, pre] = aresCommand();
try {
  execFileSync(cmd, [...pre, '--no-minify', '-o', dist, build], { stdio: 'inherit', shell: cmd.endsWith('.cmd') });
} catch (e) {
  console.error(`\nPackaging failed. Is the webOS CLI installed?  npm install -g @webos-tools/cli\n(or set ARES_PACKAGE to the ares-package path)`);
  process.exit(1);
}
console.log(`\nBuilt for ${url} → ${dist}`);
