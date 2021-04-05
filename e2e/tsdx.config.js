module.exports = {
  rollup(config) {
    // https://github.com/formium/tsdx/issues/179
    if (config.output.format === 'umd') {
      delete config.external;
    }
    return config;
  }
}
