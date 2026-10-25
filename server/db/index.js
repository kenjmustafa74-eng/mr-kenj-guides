// Data layer entry point. The rest of the server only talks to the repository interface
// documented in ./README.md, so the storage can be swapped (e.g. Firebase or Supabase)
// by adding another implementation and setting DATA_BACKEND.
const config = require('../config');

function createRepo() {
  switch (config.dataBackend) {
    case 'sqlite':
      return require('./sqlite-repo').create({ dir: config.dataDir, name: config.app.id });
    default:
      throw new Error(`Unknown DATA_BACKEND "${config.dataBackend}". Available: sqlite`);
  }
}

module.exports = { createRepo };
