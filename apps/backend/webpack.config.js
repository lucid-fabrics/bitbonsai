const { composePlugins, withNx } = require('@nx/webpack');
const path = require('path');

module.exports = composePlugins(withNx(), (config) => {
  config.resolve = config.resolve || {};
  config.resolve.alias = config.resolve.alias || {};
  config.resolve.alias['@bitbonsai/shared-models'] = path.resolve(__dirname, '../../libs/shared-models/src/index.ts');
  return config;
});
