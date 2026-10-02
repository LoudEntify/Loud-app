// native/metro.config.js — let the app import the shared, DOM-free modules
// from the web repo (lib/design/tokens.js, lib/alignment.js, ...), so the
// native app and the web app read the same rules. Only files listed in
// native/src/shared.js are imported; nothing with 'server-only' or DOM.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const root = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [root];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), path.resolve(root, 'node_modules')];
config.resolver.extraNodeModules = { '@loud/lib': path.resolve(root, 'lib') };
module.exports = config;
