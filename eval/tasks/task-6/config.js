export function mergeConfig(defaultConfig, userConfig) {
  // BUG: Shallow merge overwrites entire nested objects
  return Object.assign({}, defaultConfig, userConfig);
}
