/**
 * API 单测配置
 * 作用：让 NestJS 的 TypeScript spec 在不启动完整应用的情况下验证纯服务行为
 */
module.exports = {
  rootDir: 'src',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  collectCoverageFrom: ['**/*.(t|j)s'],
};
