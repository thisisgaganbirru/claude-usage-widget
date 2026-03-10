const path = require('path');
const rules = require('./webpack.rules');

module.exports = {
  // Put your normal webpack config below here
  module: {
    rules,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    alias: {
      '@': path.resolve(__dirname, 'src/'),
      '@main': path.resolve(__dirname, 'src/main/'),
      '@renderer': path.resolve(__dirname, 'src/renderer/'),
      '@shared': path.resolve(__dirname, 'src/shared/'),
    },
  },
};
