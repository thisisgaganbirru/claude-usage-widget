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
  plugins: [
    // Copy preload.js to output directory after webpack build
    {
      apply: (compiler) => {
        compiler.hooks.afterEmit.tap("CopyPreloadPlugin", (compilation) => {
          const fs = require("fs");
          const path = require("path");

          const srcPreload = path.join(__dirname, "src/preload/preload.js");
          const destPreload = path.join(
            compiler.options.output.path,
            "preload.js",
          );

          try {
            fs.copyFileSync(srcPreload, destPreload);
            console.log(`✅ Copied preload.js to ${destPreload}`);
          } catch (err) {
            console.error(`❌ Failed to copy preload.js: ${err.message}`);
          }
        });
      },
    },
  ],
};
