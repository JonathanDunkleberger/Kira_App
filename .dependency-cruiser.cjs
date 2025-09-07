/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['^node_modules', '^.next', '^artifacts'] },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    reporterOptions: { dot: { collapsePattern: 'node_modules/.*' } },
  },
  forbidden: [{ name: 'no-circular', severity: 'warn', from: {}, to: { circular: true } }],
};
