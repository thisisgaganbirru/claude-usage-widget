const path = require("path");
const { commonRules } = require("./webpack.rules");

module.exports = {
  // Renderer runs with nodeIntegration: false, so bundle for web context
  // to avoid runtime `require` references in the browser environment.
  target: "web",
  module: {
    rules: commonRules,
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
    alias: {
      "@": path.resolve(__dirname, "src/"),
      "@main": path.resolve(__dirname, "src/main/"),
      "@renderer": path.resolve(__dirname, "src/renderer/"),
      "@shared": path.resolve(__dirname, "src/shared/"),
    },
  },
};
