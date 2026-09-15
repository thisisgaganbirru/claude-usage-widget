const { nativeRules, commonRules } = require("./webpack.rules");

module.exports = {
  entry: {
    index: "./src/main/index.ts",
  },
  output: {
    filename: "[name].js",
  },
  target: "electron-main",
  module: {
    rules: [...nativeRules, ...commonRules],
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx"],
    alias: {
      "@main": `${__dirname}/src/main`,
      "@renderer": `${__dirname}/src/renderer`,
      "@shared": `${__dirname}/src/shared`,
    },
  },
  externals: {
    // Empty - let webpack bundle everything needed
  },
};
