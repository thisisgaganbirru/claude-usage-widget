const path = require("path");

const nativeRules = [
  {
    test: /native_modules[/\\].+\.node$/,
    use: "node-loader",
  },
  {
    test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
    parser: { amd: false },
    use: {
      loader: "@vercel/webpack-asset-relocator-loader",
      options: {
        outputAssetBase: "native_modules",
      },
    },
  },
];

const commonRules = [
  {
    test: /\.tsx?$/,
    exclude: /(node_modules|.webpack)/,
    use: {
      loader: "ts-loader",
      options: {
        transpileOnly: true,
      },
    },
  },
  {
    test: /\.css$/,
    use: ["style-loader", "css-loader", "postcss-loader"],
  },
  {
    test: /\.(png|jpg|jpeg|gif|svg|ico)$/,
    use: [
      {
        loader: "file-loader",
        options: {
          name: "[name].[ext]",
          outputPath: "assets/",
        },
      },
    ],
  },
];

module.exports = { nativeRules, commonRules };
