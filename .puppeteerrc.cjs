const path = require("node:path")

module.exports = {
  cacheDirectory: path.join(__dirname, ".cache", "puppeteer"),
  // Browser installation is explicit; ordinary unit-test installs stay light.
  skipDownload: true,
}
