const config = require('./electron-builder-config');

module.exports = {
  ...config,
  afterSign: null,
  mac: {
    ...config.mac,
    identity: '-',
    hardenedRuntime: false,
    requirements: null,
    notarize: false
  }
};
