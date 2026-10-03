export default {
  testEnvironment:'node',
  testMatch:['**/tests/**/*.spec.js','**/tests/**/*.test.js'],
  collectCoverageFrom:['src/config/*.js','src/middlewares/*.js','src/services/*.js','src/routes/*.js','src/utils/*.js','src/models/index.js'],
  coverageDirectory:'coverage',
  coverageReporters:['text','lcov'],
  coverageThreshold:{
    global:{statements:75},
    './src/middlewares/*.js':{statements:90},
    './src/services/authService.js':{statements:90,branches:90},
    './src/middlewares/auth.js':{statements:95,branches:95}
  }
};
