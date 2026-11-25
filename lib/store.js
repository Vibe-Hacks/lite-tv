// Tiny persistent key/value store (one JSON file per namespace in DATA_DIR) for login sessions.
// The files hold media-server access tokens, so they're written readable by their owner only.
// If DATA_DIR isn't writable, it keeps working in memory and logs a warning (logins then last until restart).
'use strict';
const fs = require('fs'), path = require('path');

const stores = []; // every store, so flushAll() can save them all on shutdown

function createStore(dataDir, name) {
  const file = path.join(dataDir, `${name}.json`);
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  let warned = false, timer = null;

  function write() {
    clearTimeout(timer); timer = null;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
    } catch (e) {
      if (!warned) { warned = true; console.warn(`lite-tv: can't write ${file} (${e.code}); logins will only last until restart. Set DATA_DIR to a writable folder.`); }
    }
  }
  function save() { clearTimeout(timer); timer = setTimeout(write, 200); }

  const store = {
    get: k => data[k],
    set: (k, v) => { data[k] = v; save(); },
    delete: k => { delete data[k]; save(); },
    flush: () => { if (timer) write(); },
  };
  stores.push(store);
  return store;
}

/** Write any pending changes now (called on shutdown). */
function flushAll() { for (const s of stores) s.flush(); }

module.exports = { createStore, flushAll };
