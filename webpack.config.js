const webpack = require('webpack');

module.exports = {
  entry: ['babel-polyfill', './src/index'],
  output: {
    path: 'build',
    filename: 'browser.js',
    library: 'taskcluster',
    libraryTarget: 'umd'
  },
  plugins: [
    new webpack.DefinePlugin({ IS_BROWSER: true })
  ],
  devtool: 'inline-source-map',
  module: {
    preLoaders: [
      {
        test: /\.json$/,
        loader: 'json-loader'
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'babel-loader'
      }
    ]
  }
};
