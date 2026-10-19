// Общее ядро @offix/core лежит вне приложения: подключаем его исходники напрямую.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const core = path.resolve(__dirname, '../packages/core');

config.watchFolders = [core];
config.resolver.extraNodeModules = { '@offix/core': path.join(core, 'src') };
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

module.exports = config;
